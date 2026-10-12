import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, createWriteSpy, matchesFullWhere } from './helpers/prismaDouble';
import { savePurchaseSchema, updateSupplierRrDrNoSchema } from '../validations/delivery';

// Supplier RR/DR No. — the supplier's own Receiving Report / Delivery Receipt
// number transcribed from their paperwork. NOT the CARDS PO number, NOT the
// legacy monReferenceNo, and NOT a CARDS-generated receipt.
//
// below exercises the narrow purchaser-only edit path (updateSupplierRrDrNo),
// the read-only report snapshot (getReceivingReport), and the validation
// contracts. The full write path through savePurchase, the tracker/workload
// threading, and the warehouse search arm are covered against live Postgres in
// src/lib/__tests__/e2e/liveDb.procurement.test.ts ("Supplier RR/DR No."),
// because savePurchase's chain math needs the real quantity pipeline.
//
// No database and no credentials are involved here.

const actor = vi.hoisted(() => ({
  current: { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: null as string | null } as any,
}));

vi.mock('@/actions/auth', () => ({
  getCurrentUser: async () => actor.current,
  getSession: async () => null,
  login: async () => ({ error: 'n/a' }),
  logout: async () => ({ success: true }),
  changePassword: async () => ({ error: 'n/a' }),
  adminResetPassword: async () => ({ error: 'n/a' }),
  getProfileByUsername: async () => null,
}));

const state = vi.hoisted(() => ({
  pos: [] as any[],
  records: [] as any[],
  discrepancies: [] as any[],
  audit: [] as any[],
  updateArgs: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const client = () => ({
    purchaseOrder: {
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: (po.items ?? []).map((i: any) => ({ ...i })) } : null;
      },
      update: async (args: any) => {
        spy.hook('purchaseOrder', 'update')(args);
        state.updateArgs.push(args);
        const po = state.pos.find((p) => p.poNumber === args.where?.poNumber);
        if (po) Object.assign(po, args.data);
        return po ? { ...po } : null;
      },
    },
    receivingRecord: {
      findMany: async (args: any) => state.records.filter((r) => matchesFullWhere(r, args?.where)),
    },
    receivingDiscrepancy: {
      findMany: async (args: any) => state.discrepancies.filter((d) => matchesFullWhere(d, args?.where)),
    },
    deliveryAuditLog: {
      findMany: async (args: any) => state.audit.filter((a) => matchesFullWhere(a, args?.where)),
      create: async (args: any) => {
        spy.hook('deliveryAuditLog', 'create')(args);
        const row = { id: `au-${state.audit.length + 1}`, createdAt: new Date(), ...args.data };
        state.audit.push(row);
        return row;
      },
    },
    // lockPO() issues SELECT ... FOR UPDATE through this. A lock, not a write.
    $queryRaw: async () => {
      spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/procurement') as Promise<any>;

function po(over: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-1',
    date: '2026-10-01',
    mrsNo: 'MRS-1',
    requisitioner: 'Juan',
    warehouse: 'Bajada',
    supplier: 'Trust Hardware',
    supplierAddress: null,
    supplierRrDrNo: null,
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    monReferenceNo: null,
    sourceReqNumber: null,
    approvedBy: 'Boss',
    poExpDate: null,
    notes: null,
    purchaseConfirmedBy: 'purchaser1',
    purchaseConfirmedAt: new Date('2026-10-02'),
    ...over,
  };
}

beforeEach(() => {
  state.pos = [po()];
  state.records = [
    {
      id: 'rr-1', poNumber: 'PO-1', poItemId: 'pi-1', eventId: 'ev-2',
      itemDescription: 'Cement', unit: 'bags', fromQty: 8, toQty: 10,
      actor: 'wh_bajada', editedAt: null, editedBy: null, previousToQty: null,
      createdAt: new Date('2026-10-04T10:00:00Z'),
    },
    {
      id: 'rr-0', poNumber: 'PO-1', poItemId: 'pi-1', eventId: 'ev-1',
      itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 8,
      actor: 'wh_bajada', editedAt: null, editedBy: null, previousToQty: null,
      createdAt: new Date('2026-10-03T10:00:00Z'),
    },
  ];
  state.discrepancies = [];
  state.audit = [];
  state.updateArgs = [];
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('validation contracts', () => {
  it('savePurchase accepts an optional supplier RR/DR reference and trims it', () => {
    const parsed = savePurchaseSchema.parse({
      poNumber: 'PO-1',
      items: [{ poItemId: 'pi-1', purchasedQty: 8 }],
      supplier: 'Trust Hardware',
      supplierRrDrNo: '  DR-000123  ',
    });
    expect(parsed.supplierRrDrNo).toBe('DR-000123');
  });

  it('savePurchase works without the reference (unknown at purchase time)', () => {
    const parsed = savePurchaseSchema.parse({
      poNumber: 'PO-1',
      items: [{ poItemId: 'pi-1', purchasedQty: 8 }],
      supplier: 'Trust Hardware',
    });
    expect(parsed.supplierRrDrNo).toBeUndefined();
  });

  it('both schemas reject a reference over 100 characters', () => {
    const long = 'X'.repeat(101);
    const base = { poNumber: 'PO-1', items: [{ poItemId: 'pi-1', purchasedQty: 8 }], supplier: 'S' };
    expect(() => savePurchaseSchema.parse({ ...base, supplierRrDrNo: long })).toThrow(/100/);
    expect(() => updateSupplierRrDrNoSchema.parse({ poNumber: 'PO-1', supplierRrDrNo: long })).toThrow(/100/);
  });

  it('updateSupplierRrDrNo accepts clearing the reference (absent value)', () => {
    expect(updateSupplierRrDrNoSchema.parse({ poNumber: 'PO-1' }).supplierRrDrNo).toBeUndefined();
  });
});

describe('updateSupplierRrDrNo — narrow purchaser-only edit', () => {
  it('an Admin sets the reference and the audit records the move', async () => {
    const { updateSupplierRrDrNo } = await load();
    const res = await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-000123' });
    expect(res.changed).toBe(true);
    expect(res.po.supplierRrDrNo).toBe('DR-000123');
    // Leading zeros survive: the value is text, never coerced to a number.
    expect(state.pos[0].supplierRrDrNo).toBe('DR-000123');
    const entry = state.audit.find((a: any) => a.action === 'supplier_rr_dr_set');
    expect(entry).toBeTruthy();
    expect(entry.detail).toBe('(none) -> DR-000123');
  });

  it('a second change audits as supplier_rr_dr_changed with from -> to', async () => {
    state.pos[0].supplierRrDrNo = 'DR-1';
    const { updateSupplierRrDrNo } = await load();
    await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-2' });
    const entry = state.audit.find((a: any) => a.action === 'supplier_rr_dr_changed');
    expect(entry?.detail).toBe('DR-1 -> DR-2');
  });

  it('an empty value clears the reference', async () => {
    state.pos[0].supplierRrDrNo = 'DR-1';
    const { updateSupplierRrDrNo } = await load();
    const res = await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: '   ' });
    expect(res.changed).toBe(true);
    expect(state.pos[0].supplierRrDrNo).toBeNull();
  });

  it('rewriting the same value is a no-op: no write, no audit', async () => {
    state.pos[0].supplierRrDrNo = 'DR-1';
    const { updateSupplierRrDrNo } = await load();
    const res = await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-1' });
    expect(res.changed).toBe(false);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    expect(state.spy.writesTo('deliveryAuditLog')).toEqual([]);
  });

  it('writes ONLY the reference — supplier, status and the legacy field are untouched', async () => {
    const { updateSupplierRrDrNo } = await load();
    await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-9' });
    expect(state.updateArgs).toHaveLength(1);
    expect(Object.keys(state.updateArgs[0].data)).toEqual(['supplierRrDrNo']);
    expect(state.pos[0].supplier).toBe('Trust Hardware');
    expect(state.pos[0].status).toBe('in_progress');
    expect(state.pos[0].monReferenceNo).toBeNull();
  });

  it('the same reference may sit on two POs — no uniqueness is enforced', async () => {
    state.pos.push(po({ id: 'po-2', poNumber: 'PO-2' }));
    const { updateSupplierRrDrNo } = await load();
    await updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'SHARED-1' });
    await updateSupplierRrDrNo({ poNumber: 'PO-2', supplierRrDrNo: 'SHARED-1' });
    expect(state.pos[0].supplierRrDrNo).toBe('SHARED-1');
    expect(state.pos[1].supplierRrDrNo).toBe('SHARED-1');
  });

  it('rejects an unknown PO', async () => {
    const { updateSupplierRrDrNo } = await load();
    await expect(updateSupplierRrDrNo({ poNumber: 'NOPE', supplierRrDrNo: 'DR-1' })).rejects.toThrow(
      /not found/,
    );
  });

  it('rejects a Warehouse role before any write', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updateSupplierRrDrNo } = await load();
    await expect(updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-1' })).rejects.toThrow(
      /only purchasers and superadmins/i,
    );
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { updateSupplierRrDrNo } = await load();
    await expect(updateSupplierRrDrNo({ poNumber: 'PO-1', supplierRrDrNo: 'DR-1' })).rejects.toThrow(
      /only purchasers and superadmins/i,
    );
    expect(state.spy.callsTo()).toEqual([]);
  });
});

describe('getReceivingReport — read-only snapshot', () => {
  it('returns the PO header with the supplier RR/DR number', async () => {
    state.pos[0].supplierRrDrNo = 'DR-000123';
    const { getReceivingReport } = await load();
    const report = await getReceivingReport('PO-1');
    expect(report.po.poNumber).toBe('PO-1');
    expect(report.po.supplierRrDrNo).toBe('DR-000123');
    expect(report.po.supplier).toBe('Trust Hardware');
  });

  it('lists receiving events newest-first with per-line from -> to deltas', async () => {
    const { getReceivingReport } = await load();
    const report = await getReceivingReport('PO-1');
    expect(report.receivingEvents.map((e: any) => e.eventId)).toEqual(['ev-2', 'ev-1']);
    const latest = report.receivingEvents[0];
    expect(latest.lines).toHaveLength(1);
    expect(latest.lines[0]).toMatchObject({ fromQty: 8, toQty: 10, delta: 2 });
  });

  it('includes every discrepancy, open and resolved', async () => {
    state.discrepancies = [
      {
        id: 'd-1', poNumber: 'PO-1', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags',
        discrepancyType: 'short', remarks: '2 bags short', status: 'resolved',
        reportedBy: 'wh_bajada', reportedAt: new Date('2026-10-03T11:00:00Z'),
        resolvedBy: 'purchaser1', resolvedAt: new Date('2026-10-04T09:00:00Z'), resolution: 'credited',
      },
    ];
    const { getReceivingReport } = await load();
    const report = await getReceivingReport('PO-1');
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0]).toMatchObject({ discrepancyType: 'short', status: 'resolved' });
  });

  it('performs no write of any kind — viewing the report mutates nothing', async () => {
    const { getReceivingReport } = await load();
    await getReceivingReport('PO-1');
    // The auth/ownership reads and the row lock are reads; every DATA write
    // hook must be silent.
    const dataWrites = state.spy.callsTo().filter((c: string) => !c.startsWith('lock.'));
    expect(dataWrites).toEqual([]);
  });

  it('rejects an unknown PO', async () => {
    const { getReceivingReport } = await load();
    await expect(getReceivingReport('NOPE')).rejects.toThrow(/not found/);
  });

  it('lets the owning warehouse read but refuses another warehouse', async () => {
    const { getReceivingReport } = await load();
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    await expect(getReceivingReport('PO-1')).resolves.toMatchObject({ po: { poNumber: 'PO-1' } });

    actor.current = { id: 'u-other', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' };
    await expect(getReceivingReport('PO-1')).rejects.toThrow(/unauthorized/i);
  });

  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { getReceivingReport } = await load();
    await expect(getReceivingReport('PO-1')).rejects.toThrow(/unauthorized/i);
  });
});
