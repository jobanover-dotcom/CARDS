// Repair purchase orders whose stored status disagrees with their own quantities.
//
// WHY THIS EXISTS
//
//   `approvedQty` is a PO's ALLOCATED SHARE of its material request, not its own
//   line qty, and it is recomputed from every PO on the same MRS
//   (`allocateForMRS`, src/lib/mrsRequirement.ts). Buying units on one PO shrinks a
//   SIBLING's share, so a sibling whose share falls to exactly what it already
//   bought and received becomes complete without any of its own rows changing.
//
//   `PurchaseOrder.status` used to be written only by the action that touched a
//   PO, so such a sibling kept a status its quantities had already disproved and
//   sat in the warehouse's In Progress section forever. `savePurchase` and
//   `createFollowUpPO` now re-evaluate the whole requirement, so no NEW row can
//   get stuck that way. This script is for the rows already written before that
//   fix, which nothing else will ever revisit.
//
//   It reports a PO only when it is ALREADY complete on quantities and is not
//   recorded as such. It never completes a PO that still owes units, and it never
//   reopens one: a status is only ever corrected in the direction its own
//   quantities already imply.
//
// USAGE
//
//   node scripts/reconcile-po-status.mjs            report only, changes nothing
//   node scripts/reconcile-po-status.mjs --apply    write the corrections
//   node scripts/reconcile-po-status.mjs --po PO7838   one purchase order
//
//   Dry-run is the default, and deliberately so: this writes to a live database.
//   Each correction also writes a `po_completed` audit row, so the repair is
//   visible in the PO's own history and attributed to this script.
import 'dotenv/config';
import { register } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// src/lib/*.ts import each other with EXTENSIONLESS relative specifiers
// ('./mrsAggregates'), which Node's ESM resolver refuses. Node strips TypeScript
// types natively, so a resolve hook is the only thing standing between this script
// and the real domain logic — which is the whole point: the allocation must be
// computed by the same code the application uses, never re-derived here.
register(
  `data:text/javascript,${encodeURIComponent(`
    export function resolve(specifier, context, next) {
      if (specifier.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
        for (const candidate of [specifier + '.ts', specifier + '/index.ts', specifier + '.js']) {
          try { return next(candidate, context); } catch { /* try the next shape */ }
        }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const ROOT = new URL('../src/lib/', import.meta.url);
const { normalizeItemDescription } = await import(new URL('mrsAggregates.ts', ROOT));
const { evaluatePOCompletion } = await import(new URL('deliveryQuantities.ts', ROOT));
const { readMRSData } = await import(new URL('mrsRequirement.ts', ROOT));
const { poLifecycle, PO_STATUS } = await import(new URL('deliveryStatus.ts', ROOT));
const { buildPOItemChain } = await import(new URL('deliveryQuantities.ts', ROOT));

const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--po');
  return i === -1 ? null : process.argv[i + 1] ?? null;
})();

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 15_000,
  }),
});

/** The same chain `chainFromPO` builds, priced against this PO's allocated share. */
function chainsFor(po, source, allocation) {
  return po.items.map((item) => {
    const matched = source
      ? source.items.find(
          (r) => normalizeItemDescription(r.itemDescription) === normalizeItemDescription(item.itemDescription),
        )
      : null;
    const allocated = allocation?.get(normalizeItemDescription(item.itemDescription));
    return {
      ...buildPOItemChain({
        requestedQty: matched ? matched.qty : item.qty,
        approvedQty: allocated ?? (matched ? (matched.approvedQty ?? matched.qty) : item.qty),
        purchasedQty: item.purchasedQty,
        receivedQty: item.receivedQty,
      }),
      itemDescription: item.itemDescription,
      unit: item.unit,
    };
  });
}

async function main() {
  const scope = ONLY ? await prisma.purchaseOrder.findMany({ where: { poNumber: ONLY }, select: { mrsNo: true } }) : [];
  const mrsNumbers = ONLY ? scope.map((p) => p.mrsNo).filter(Boolean) : null;
  if (ONLY && !mrsNumbers.length) throw new Error(`No purchase order found with number ${ONLY}`);

  const allMrs = mrsNumbers ?? (await prisma.purchaseOrder.findMany({ select: { mrsNo: true } })).map((p) => p.mrsNo).filter(Boolean);

  const candidates = [];
  for (const mrsNo of [...new Set(allMrs)]) {
    const { allocations, pos } = await readMRSData(prisma, [mrsNo]);
    const requests = await prisma.warehouseRequest.findMany({
      where: { OR: [{ mrsNo }, { reqNumber: { in: pos.map((p) => p.sourceReqNumber).filter(Boolean) } }] },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });
    const earliest = requests.find((r) => r.mrsNo === mrsNo) ?? null;

    for (const po of pos) {
      if (ONLY && po.poNumber !== ONLY) continue;
      const lifecycle = poLifecycle(po.status);
      // Cancelled POs keep the requirement's units reserved (allocateForMRS reads
      // no status), so they are never judged. Completed ones are already right.
      if (lifecycle === PO_STATUS.CANCELLED.value || lifecycle === PO_STATUS.COMPLETED.value) continue;

      const lines = allocations.get(mrsNo)?.get(po.poNumber);
      const allocation = lines
        ? new Map(lines.map((l) => [normalizeItemDescription(l.itemDescription), l.allocatedApproved]))
        : undefined;
      const chains = chainsFor(po, earliest, allocation);
      const completion = evaluatePOCompletion({ chains });
      if (!completion.canComplete) continue;

      candidates.push({
        poNumber: po.poNumber,
        mrsNo,
        status: po.status,
        totals: {
          approved: chains.reduce((s, c) => s + c.approvedQty, 0),
          purchased: chains.reduce((s, c) => s + c.purchasedQty, 0),
          received: chains.reduce((s, c) => s + c.receivedQty, 0),
        },
        items: chains.map((c) => `${c.itemDescription} ${c.purchasedQty}/${c.approvedQty} bought`),
      });
    }
  }

  if (!candidates.length) {
    console.log('No purchase order disagrees with its own quantities. Nothing to repair.');
    return;
  }

  console.log(
    APPLY
      ? `\n${candidates.length} purchase order(s) to complete:\n`
      : `\n${candidates.length} purchase order(s) fully purchased and received but NOT recorded as completed:\n`,
  );
  for (const c of candidates) {
    console.log(
      `  ${c.poNumber}  ${c.mrsNo}  status=${c.status}  approved=${c.totals.approved} purchased=${c.totals.purchased} received=${c.totals.received}`,
    );
    console.log(`      ${c.items.join(' | ')}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these corrections.');
    return;
  }

  console.log('');
  for (const c of candidates) {
    await prisma.$transaction(async (tx) => {
      // Re-read under the write so a purchase recorded since this scan cannot be
      // overwritten by a conclusion drawn before it.
      const fresh = await tx.purchaseOrder.findUnique({ where: { poNumber: c.poNumber } });
      if (!fresh || poLifecycle(fresh.status) === PO_STATUS.COMPLETED.value) return;
      await tx.purchaseOrder.update({
        where: { poNumber: c.poNumber },
        data: {
          status: PO_STATUS.COMPLETED.value,
          statusLabel: PO_STATUS.COMPLETED.label,
        },
      });
      await tx.deliveryAuditLog.create({
        data: {
          deliveryId: null,
          poNumber: c.poNumber,
          action: 'po_completed',
          detail:
            'Every PO item is fully purchased and fully received — repaired by ' +
            'scripts/reconcile-po-status.mjs; its share of ' +
            `${c.mrsNo} was settled by a purchase recorded on another purchase order`,
          actor: 'reconcile-po-status',
        },
      });
    });
    console.log(`  completed ${c.poNumber}`);
  }
  console.log(`\n${candidates.length} purchase order(s) repaired.`);
}

try {
  await main();
} catch (e) {
  console.error('reconcile-po-status failed:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}