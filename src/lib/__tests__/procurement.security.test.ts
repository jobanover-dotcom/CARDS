import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/procurement.ts (authorization surface only)
//
// FINDING under test: `assertWarehouseOwns` (actions/procurement.ts:111-118)
// guards receiving with `if (poWarehouse && poWarehouse !== user.warehouse)`. The
// truthiness test means a PO whose warehouse is NULL passes the check for EVERY
// Warehouse user, so an unassigned or legacy PO is receivable by any site.
//
// This file duplicates a fixture subset from receivingHistory.test.ts on purpose:
// each suite stands alone rather than sharing mutable state, so one file failing
// cannot mask another.

const actor = vi.hoisted(() => ({
  current: { id: 'u-wh', username: 'wh_bajada', role: 'Warehouse', warehouse: 'Bajada' } as any,
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
  // The approved requirement behind MRS-1, so a tracker has a source request.
  requests: [] as any[],
  records: [] as any[],
  discrepancies: [] as any[],
  audit: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const client = () => ({
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: po.items ?? [] } : null;
      },
      findFirst: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where))[0] ?? null,
      count: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)).length,
      update: async (args: any) => {
        spy.hook('purchaseOrder', 'update')(args);
        const po = state.pos.find((p) => p.poNumber === args.where?.poNumber);
        if (po) Object.assign(po, args.data);
        return po;
      },
    },
    purchaseOrderItem: {
      findMany: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return (po?.items ?? []).map((i: any) => ({ ...i }));
      },
      findUnique: async (args: any) => {
        for (const po of state.pos) {
          const item = (po.items ?? []).find((i: any) => i.id === args?.where?.id);
          if (item) return { ...item };
        }
        return null;
      },
      update: async (args: any) => {
        spy.hook('purchaseOrderItem', 'update')(args);
        for (const po of state.pos) {
          const item = (po.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return args.data;
      },
    },
    receivingRecord: {
      findMany: async (args: any) => state.records.filter((r) => matchesFullWhere(r, args?.where)),
      // editLatestReceiving reads the newest event for the PO to find its floor.
      findFirst: async (args: any) =>
        state.records.filter((r) => matchesFullWhere(r, args?.where)).slice(-1)[0] ?? null,
      create: async (args: any) => {
        spy.hook('receivingRecord', 'create')(args);
        const row = { id: `rr-${state.records.length + 1}`, createdAt: new Date(), ...args.data };
        state.records.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('receivingRecord', 'update')(args);
        return args.data;
      },
      deleteMany: async (args: any) => {
        spy.hook('receivingRecord', 'deleteMany')(args);
        return { count: 0 };
      },
    },
    receivingDiscrepancy: {
      findMany: async (args: any) => state.discrepancies.filter((d) => matchesFullWhere(d, args?.where)),
      findUnique: async (args: any) => state.discrepancies.find((d) => d.id === args?.where?.id) ?? null,
      create: async (args: any) => {
        spy.hook('receivingDiscrepancy', 'create')(args);
        const row = { id: `d-${state.discrepancies.length + 1}`, ...args.data };
        state.discrepancies.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('receivingDiscrepancy', 'update')(args);
        const d = state.discrepancies.find((x) => x.id === args.where?.id);
        if (d) Object.assign(d, args.data);
        return d;
      },
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
    // buildPOChains → loadSourceRequest resolves the requirement behind a PO
    // through these, so a tracker can be built at all.
    warehouseRequest: {
      findMany: async (args: any) => state.requests.filter((r) => matchesFullWhere(r, args?.where)),
      findUnique: async (args: any) => state.requests.find((r) => r.reqNumber === args?.where?.reqNumber) ?? null,
      // The mrsNo fallback lookup: oldest request on the same material request.
      findFirst: async (args: any) => state.requests.filter((r) => matchesFullWhere(r, args?.where))[0] ?? null,
    },
    requestApprovalLog: { findMany: async () => [] },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/procurement') as Promise<any>;

/**
 * Data writes only. `SELECT ... FOR UPDATE` is a lock, not a mutation, so it is
 * excluded: a rejected operation must reach the database for no *data* change,
 * but this suite records the lock separately so ordering can be asserted too.
 */
function dataWrites() {
  return state.spy.callsTo().filter((c: string) => !c.startsWith('lock.'));
}

function po(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [
    { id: 'pi-1', poNumber: 'PO-1', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 100, receivedQty: 0, itemId: null },
  ];
  return {
    id: 'po-1', poNumber: 'PO-1', date: '2026-10-01', mrsNo: 'MRS-1',
    requisitioner: 'Juan', warehouse: 'Bajada', supplier: 'Trust Hardware',
    status: 'in_progress', statusLabel: 'In Progress', poType: 'active-delivery',
    sourceReqNumber: null, profileId: 'u-admin', createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'),
    ...over,
    items,
  };
}

beforeEach(() => {
  state.pos = [po(), po({ id: 'po-2', poNumber: 'PO-2', warehouse: 'North', mrsNo: 'MRS-2', items: [{ id: 'pi-2', poNumber: 'PO-2', itemDescription: 'Nails', unit: 'kg', qty: 50, purchasedQty: 50, receivedQty: 0, itemId: null }] })];
  state.requests = [
    { id: 'req-1', reqNumber: 'REQ-1', mrsNo: 'MRS-1', warehouse: 'Bajada', requisitioner: 'Juan', requestedBy: 'Ana', date: '2026-10-01', status: 'Approved', createdAt: new Date('2026-10-01'), items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }] },
    { id: 'req-2', reqNumber: 'REQ-2', mrsNo: 'MRS-2', warehouse: 'North', requisitioner: 'Juan', requestedBy: 'Ana', date: '2026-10-01', status: 'Approved', createdAt: new Date('2026-10-01'), items: [{ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: 50, rejectedQty: 0 }] },
  ];
  state.records = [];
  state.discrepancies = [];
  state.audit = [];
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('savePurchase / createFollowUpPO — purchaser-only', () => {
  it('savePurchase rejects a Warehouse role before any write', async () => {
    const { savePurchase } = await load();
    await expect(
      savePurchase({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', purchasedQty: 50 }], supplier: 'X' }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('savePurchase rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { savePurchase } = await load();
    await expect(
      savePurchase({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', purchasedQty: 50 }], supplier: 'X' }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('createFollowUpPO rejects a Warehouse role before any write', async () => {
    const { createFollowUpPO } = await load();
    await expect(
      createFollowUpPO({ originalPoNumber: 'PO-1', poNumber: 'PO-NEW', date: '2026-10-05', items: [{ itemDescription: 'Cement', qty: 10 }] }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });
});

describe('resolveDiscrepancy — purchaser-only, and a warehouse user may not clear its own flag', () => {
  it('rejects a Warehouse role before any write', async () => {
    state.discrepancies = [{
      id: 'd-1', poNumber: 'PO-1', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags',
      discrepancyType: 'Damaged', remarks: null, status: 'open',
      reportedBy: 'wh_bajada', reportedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null,
    }];
    const { resolveDiscrepancy } = await load();

    await expect(resolveDiscrepancy({ id: 'd-1', poNumber: 'PO-1', resolution: 'all fine' })).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.discrepancies[0].status).toBe('open');
    expect(state.spy.writesTo('receivingDiscrepancy')).toEqual([]);
  });

  it('admits an Admin and records the resolution', async () => {
    state.discrepancies = [{
      id: 'd-1', poNumber: 'PO-1', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags',
      discrepancyType: 'Damaged', remarks: null, status: 'open',
      reportedBy: 'wh_bajada', reportedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null,
    }];
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { resolveDiscrepancy } = await load();

    await resolveDiscrepancy({ id: 'd-1', poNumber: 'PO-1', resolution: 'Supplier replaced' });

    expect(state.discrepancies[0]).toMatchObject({ status: 'resolved', resolution: 'Supplier replaced' });
  });

  it('refuses a mismatch between the discrepancy id and the PO number', async () => {
    state.discrepancies = [{
      id: 'd-1', poNumber: 'PO-1', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags',
      discrepancyType: 'Damaged', remarks: null, status: 'open',
      reportedBy: 'wh_bajada', reportedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null,
    }];
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { resolveDiscrepancy } = await load();

    await expect(resolveDiscrepancy({ id: 'd-1', poNumber: 'PO-2', resolution: 'x' })).rejects.toThrow();
    expect(state.discrepancies[0].status).toBe('open');
  });
});

describe('recordReceiving — FINDING: a null-warehouse PO is claimable by any Warehouse user', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { recordReceiving } = await load();
    await expect(
      recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 10 }] }),
    ).rejects.toThrow(/only warehouse users can record receiving/i);
    // No data write. A row lock IS taken first — see the ordering test below.
    expect(dataWrites()).toEqual([]);
  });

  it('rejects a purchaser role', async () => {
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { recordReceiving } = await load();
    await expect(
      recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 10 }] }),
    ).rejects.toThrow(/only warehouse users can record receiving/i);
    expect(dataWrites()).toEqual([]);
  });

  it('OBSERVATION: the row lock is taken BEFORE the authorization check', async () => {
    // recordReceiving does lockPO() then assertWarehouseOwns(). The caller is
    // rejected, but only after the PO row lock has been acquired and is held for
    // the remainder of the transaction. Correctness is unaffected (the lock is
    // released on rollback); it lengthens the lock an unauthorized caller can
    // make every caller wait behind.
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 10 }] }),
    ).rejects.toThrow();

    expect(state.spy.callsTo()).toEqual(['lock.$queryRaw']);
    expect(dataWrites()).toEqual([]);
  });

  it('rejects a Warehouse user receiving on ANOTHER site PO (IDOR closed)', async () => {
    const { recordReceiving } = await load();
    await expect(
      recordReceiving({ poNumber: 'PO-2', items: [{ poItemId: 'pi-2', receivedQty: 10 }] }),
    ).rejects.toThrow(/belongs to another warehouse/i);
    expect(state.spy.writesTo('purchaseOrderItem')).toEqual([]);
  });

  it('permits a Warehouse user receiving on its OWN PO', async () => {
    const { recordReceiving } = await load();
    await recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 10 }] });
    expect(state.pos[0].items[0].receivedQty).toBe(10);
  });

  it('rejects a PO with a NULL warehouse — ownership fails closed', async () => {
    // A null-warehouse PO belongs to nobody, so no Warehouse user may receive it.
    state.pos = [po({ warehouse: null })];
    actor.current = { id: 'u-n', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' };
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 10 }] }),
    ).rejects.toThrow(/not assigned to a warehouse/i);

    expect(state.pos[0].items[0].receivedQty).toBe(0);
    expect(dataWrites()).toEqual([]);
  });

  it('rejects a null-warehouse PO for EVERY warehouse user, not just other sites', async () => {
    state.pos = [po({ warehouse: null })];
    const { recordReceiving } = await load();

    for (const warehouse of ['Bajada', 'North', null]) {
      actor.current = { id: `u-${warehouse}`, username: 'wh', role: ROLES.warehouse, warehouse };
      await expect(
        recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 5 }] }),
      ).rejects.toThrow(/not assigned to a warehouse/i);
    }

    expect(state.pos[0].items[0].receivedQty).toBe(0);
  });

  it('the null-warehouse fail-closed rule also covers editLatestReceiving', async () => {
    state.pos = [po({ warehouse: null })];
    state.records = [{
      id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-1', poItemId: 'pi-1',
      itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 10,
      actor: 'wh_bajada', createdAt: new Date(), editedAt: null, editedBy: null, previousToQty: null,
    }];
    actor.current = { id: 'u-n', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' };
    const { editLatestReceiving } = await load();

    await expect(
      editLatestReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', toQty: 20 }] }),
    ).rejects.toThrow(/not assigned to a warehouse/i);

    expect(state.pos[0].items[0].receivedQty).toBe(0);
  });

  it('a Warehouse user still cannot touch an owned PO belonging to another site', async () => {
    actor.current = { id: 'u-n', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' };
    const { recordReceiving } = await load();
    await expect(
      recordReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', receivedQty: 5 }] }),
    ).rejects.toThrow(/belongs to another warehouse/i);
  });

  it('editLatestReceiving rejects an ANOTHER-site PO — the S5 fix did not weaken this', async () => {
    // The null-warehouse fix rewrote assertWarehouseOwns, so this control is
    // re-pinned explicitly: the owning check must still fire for a real mismatch.
    state.records = [{
      id: 'rr-2', eventId: 'ev-2', poNumber: 'PO-2', poItemId: 'pi-2',
      itemDescription: 'Nails', unit: 'kg', fromQty: 0, toQty: 10,
      actor: 'wh_north', createdAt: new Date(), editedAt: null, editedBy: null, previousToQty: null,
    }];
    // Caller is from Bajada; PO-2 belongs to North.
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { editLatestReceiving } = await load();

    await expect(
      editLatestReceiving({ poNumber: 'PO-2', items: [{ poItemId: 'pi-2', toQty: 20 }] }),
    ).rejects.toThrow(/belongs to another warehouse/i);

    expect(state.pos[1].items[0].receivedQty).toBe(0);
    expect(dataWrites()).toEqual([]);
  });

  it('editLatestReceiving still permits the OWNING warehouse', async () => {
    state.records = [{
      id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-1', poItemId: 'pi-1',
      itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 10,
      actor: 'wh_bajada', createdAt: new Date(), editedAt: null, editedBy: null, previousToQty: null,
    }];
    const { editLatestReceiving } = await load();

    await editLatestReceiving({ poNumber: 'PO-1', items: [{ poItemId: 'pi-1', toQty: 20 }] });

    expect(state.pos[0].items[0].receivedQty).toBe(20);
  });
});

describe('read actions — warehouse scoping', () => {
  it('getPODiscrepancies refuses another site PO', async () => {
    const { getPODiscrepancies } = await load();
    await expect(getPODiscrepancies('PO-2')).rejects.toThrow(/Unauthorized/);
  });

  it('getPOAuditLog refuses another site PO', async () => {
    const { getPOAuditLog } = await load();
    await expect(getPOAuditLog('PO-2')).rejects.toThrow(/Unauthorized/);
  });

  it('getReceivingHistory refuses another site PO', async () => {
    const { getReceivingHistory } = await load();
    await expect(getReceivingHistory('PO-2')).rejects.toThrow(/Unauthorized/);
  });

  it('getPOTracker refuses another site PO', async () => {
    const { getPOTracker } = await load();
    await expect(getPOTracker('PO-2')).rejects.toThrow(/Unauthorized/);
  });

  it('getPOTracker allows the owning warehouse', async () => {
    const { getPOTracker } = await load();
    await expect(getPOTracker('PO-1')).resolves.toBeTruthy();
  });
});

describe('dashboard and report reads are purchaser-only', () => {
  it('getDashboardOverview rejects a Warehouse role', async () => {
    const { getDashboardOverview } = await load();
    await expect(getDashboardOverview({})).rejects.toThrow(/only purchasers and superadmins/i);
  });

  it('getReportRows rejects a Warehouse role', async () => {
    const { getReportRows } = await load();
    await expect(getReportRows({ report: 'monitoring' })).rejects.toThrow(/only purchasers and superadmins/i);
  });
});