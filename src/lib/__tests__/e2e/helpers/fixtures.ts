import { nextPoNumber } from './harness';

// Fixture builders shared by the live suites.
//
// These were duplicated per file, which is how the two suites drifted: the
// discrepancy suite's copies were deleted during the helper consolidation and
// had to be restored here rather than re-invented in two places again.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prisma = any;

export interface FixtureContext {
  prisma: Prisma;
  /** Actions under test, imported lazily inside `beforeAll`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pos: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  procurement: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requests: any;
  /** The warehouse every test PO and request is attached to. */
  warehouseName: string;
  /** The Admin actor, already bound to the real profile id. */
  admin: { id: string; username: string; role: string; warehouse: string | null };
  /** The Warehouse actor, already bound to the real profile id. */
  warehouse: { id: string; username: string; role: string; warehouse: string | null };
  /** Read by `getCurrentUser` at await time, so every concurrent leg must share a role. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actor: { current: any };
  /** Records a PO created by a test. */
  trackPo(poNumber: string): Promise<string> | string;
  /** Records a request created by a test. */
  trackRequest(reqNumber: string): Promise<string> | string;
}

/**
 * Raise a Warehouse request carrying `items` and approve it in full, so the MRS
 * has a real approved allowance behind it.
 *
 * The request number is allocated server-side, so it is tracked rather than
 * chosen.
 */
export async function makeRequest(
  ctx: FixtureContext,
  mrsNo: string,
  items: { itemDescription: string; qty: number; unit: string }[],
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ reqNumber: string; items: any[] }> {
  const restore = ctx.actor.current;

  ctx.actor.current = { ...ctx.warehouse, warehouse: ctx.warehouseName };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created: any = await ctx.requests.createRequest({
    date: '2026-10-01',
    mrsNo,
    requestedBy: 'E2E Requester',
    requisitioner: 'E2E Requisitioner',
    items,
  });
  ctx.trackRequest(created.reqNumber);

  // Approve in full: a decision action, so it needs the purchaser role.
  ctx.actor.current = { ...ctx.admin, warehouse: ctx.warehouseName };
  await ctx.requests.approveRequest(created.reqNumber);

  ctx.actor.current = restore;
  const settled = await ctx.prisma.warehouseRequest.findUnique({
    where: { reqNumber: created.reqNumber },
    include: { items: true },
  });
  return { reqNumber: created.reqNumber, items: settled?.items ?? [] };
}

/**
 * Raise a purchase order against an MRS.
 *
 * `mrsNo` is explicit so a caller can place several POs on one requirement;
 * when omitted the PO gets its own private MRS.
 */
export async function makePO(
  ctx: FixtureContext,
  label: string,
  items: { itemDescription: string; qty: number; unit: string }[],
  opts: { mrsNo?: string; reqNumber?: string; poNumber?: string } = {},
): Promise<string> {
  const poNumber = await ctx.trackPo(opts.poNumber ?? nextPoNumber(label));
  const restore = ctx.actor.current;
  ctx.actor.current = { ...ctx.admin, warehouse: ctx.warehouseName };
  try {
    await ctx.pos.createPO({
      date: '2026-10-02',
      poNumber,
      items,
      requisitioner: 'E2E Requisitioner',
      mrsNo: opts.mrsNo ?? `${poNumber}-MRS`,
      sourceReqNumber: opts.reqNumber,
      warehouse: ctx.warehouseName,
      listedBy: 'e2e-purchaser',
    });
  } finally {
    ctx.actor.current = restore;
  }
  return poNumber;
}

/** Map an item description to its PurchaseOrderItem id on a given PO. */
export async function lineIds(ctx: FixtureContext, poNumber: string): Promise<Map<string, string>> {
  const items = await ctx.prisma.purchaseOrderItem.findMany({
    where: { poNumber },
    orderBy: { itemDescription: 'asc' },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Map(items.map((i: any) => [i.itemDescription as string, i.id as string]));
}