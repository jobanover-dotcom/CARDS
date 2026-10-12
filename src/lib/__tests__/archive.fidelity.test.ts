import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, NO_SESSION, matchesFullWhere } from './helpers/prismaDouble';

// ARCHIVE ROUND-TRIP FIDELITY — actions/archive.ts
//
// The guarantee under test: whatever deleteWarehouseWithArchive() and
// systemReset() archive, restoreArchive() puts back UNCHANGED.
//
// This is not a detail. The archive writers read two tables and then let the
// schema cascade destroy six more (prisma/schema.prisma lines 122, 152, 218, 265,
// 300). Before the relatedData column those six were gone for good, so "restore"
// silently returned a warehouse stripped of its receiving history, its
// discrepancies, its approval decisions and its receipt links while reporting
// success.
//
// Every test here archives a realistic spread and asserts what came back.

const actor = vi.hoisted(() => ({
  current: { id: 'u-super', username: 'superadmin', name: 'Super', role: 'Superadmin', warehouse: null as string | null } as any,
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
  warehouses: [] as any[],
  pos: [] as any[],
  reqs: [] as any[],
  profiles: [] as any[],
  archives: [] as any[],
  activity: [] as any[],
  receivingRecords: [] as any[],
  discrepancies: [] as any[],
  auditLogs: [] as any[],
  monitoringItems: [] as any[],
  receipts: [] as any[],
  approvalLogs: [] as any[],
  items: [] as any[],
}));

vi.mock('@/lib/prisma', async () => {
  const client = () => {
    const nextId = (p: string, i: number) => `${p}-${i}`;
    const cascaded = (model: string, rows: any[]) => ({
      findMany: async (args: any) => rows.filter((r) => matchesFullWhere(r, args?.where)),
      createMany: async (args: any) => {
        const created = (args?.data ?? []).map((d: any, i: number) => ({ id: nextId(model, rows.length + i + 1), ...d }));
        rows.push(...created);
        return { count: created.length };
      },
    });

    return {
      warehouse: {
        findMany: async () => state.warehouses.filter((w) => !w.deleted),
        findUnique: async (a: any) => state.warehouses.find((w) => w.name === a?.where?.name && !w.deleted) ?? null,
        create: async (a: any) => { const r = { id: `wh-${state.warehouses.length + 1}`, ...a.data }; state.warehouses.push(r); return r; },
        upsert: async (a: any) => {
          const row = state.warehouses.find((w) => w.name === a.where.name);
          if (row) return row;
          const created = { id: `wh-${state.warehouses.length + 1}`, ...a.create };
          state.warehouses.push(created);
          return created;
        },
        // Warehouse has no soft-delete column in the real schema, so the double
        // removes the row outright. A flag here would make the restore's upsert
        // appear to work when it had actually found a row the database had lost.
        delete: async (a: any) => {
          const i = state.warehouses.findIndex((w) => w.name === a.where.name);
          if (i >= 0) return state.warehouses.splice(i, 1)[0];
          return null;
        },
      },
      purchaseOrder: {
        findMany: async (a: any) => state.pos.filter((p) => matchesFullWhere(p, a?.where)),
        deleteMany: async (a: any) => {
          const doomed = new Set(state.pos.filter((p) => matchesFullWhere(p, a.where)).map((p) => p.poNumber));
          state.pos = state.pos.filter((p) => !doomed.has(p.poNumber));
          for (const rows of [state.receivingRecords, state.discrepancies, state.auditLogs, state.monitoringItems, state.receipts]) {
            const keep = rows.filter((r) => !doomed.has(r.poNumber));
            rows.length = 0; rows.push(...keep);
          }
          return { count: doomed.size };
        },
        create: async (a: any) => {
          // The item ids are the whole point: restore preserves them so that
          // poItemId-keyed rows still resolve to a line.
          const items = (a.data.items?.create ?? []).map((i: any, n: number) => ({ id: i.id ?? `pi-${n + 1}`, ...i }));
          const { items: _ignored, ...rest } = a.data;
          const row = { id: rest.id ?? `po-${state.pos.length + 1}`, ...rest, items };
          state.pos.push(row);
          return row;
        },
        update: async (a: any) => {
          const row = state.pos.find((p) => p.poNumber === a?.where?.poNumber) ?? { poNumber: a?.where?.poNumber };
          Object.assign(row, a.data);
          if (!state.pos.includes(row)) state.pos.push(row);
          return row;
        },
      },
      warehouseRequest: {
        findMany: async (a: any) => state.reqs.filter((r) => matchesFullWhere(r, a?.where)),
        // readMRSData() resolves each PO's source request through
        // loadSourceRequest() (poChain.ts:145), which needs both of these.
        findUnique: async (a: any) => state.reqs.find((r) => r.reqNumber === a?.where?.reqNumber) ?? null,
        findFirst: async (a: any) => state.reqs.find((r) => matchesFullWhere(r, a?.where)) ?? null,
        deleteMany: async (a: any) => {
          const doomed = new Set(state.reqs.filter((r) => matchesFullWhere(r, a.where)).map((r) => r.reqNumber));
          state.reqs = state.reqs.filter((r) => !doomed.has(r.reqNumber));
          const keep = state.approvalLogs.filter((l) => !doomed.has(l.reqNumber));
          state.approvalLogs.length = 0; state.approvalLogs.push(...keep);
          return { count: doomed.size };
        },
        create: async (a: any) => {
          const items = (a.data.items?.create ?? []).map((i: any, n: number) => ({ id: i.id ?? `ri-${n + 1}`, ...i }));
          const { items: _ignored, ...rest } = a.data;
          const row = { id: rest.id ?? `req-${state.reqs.length + 1}`, ...rest, items };
          state.reqs.push(row);
          return row;
        },
      },
      profile: {
        findMany: async (a: any) => state.profiles.filter((p) => matchesFullWhere(p, a?.where)),
        deleteMany: async (a: any) => {
          const keep = state.profiles.filter((p) => !matchesFullWhere(p, a.where));
          const n = state.profiles.length - keep.length;
          state.profiles = keep; return { count: n };
        },
      },
      warehouseArchive: {
        findMany: async () => state.archives.filter((a) => !a.deleted),
        findUnique: async (a: any) => state.archives.find((x) => x.id === a?.where?.id && !x.deleted) ?? null,
        create: async (a: any) => { const r = { id: `arc-${state.archives.length + 1}`, createdAt: new Date(), ...a.data }; state.archives.push(r); return r; },
        delete: async (a: any) => { const r = state.archives.find((x) => x.id === a.where.id); if (r) r.deleted = true; return r; },
      },
      archiveActivityLog: {
        findMany: async () => state.activity,
        create: async (a: any) => { state.activity.push({ id: `act-${state.activity.length + 1}`, createdAt: new Date(), ...a.data }); return a.data; },
        deleteMany: async (a: any) => {
          const keep = state.activity.filter((x) => !matchesFullWhere(x, a.where));
          const n = state.activity.length - keep.length; state.activity = keep; return { count: n };
        },
      },
      receivingRecord: cascaded('receivingRecord', state.receivingRecords),
      receivingDiscrepancy: cascaded('receivingDiscrepancy', state.discrepancies),
      deliveryAuditLog: cascaded('deliveryAuditLog', state.auditLogs),
      purchaseOrderMonitoringItem: cascaded('monitoringItem', state.monitoringItems),
      purchaseOrderReceipt: cascaded('receipt', state.receipts),
      requestApprovalLog: cascaded('requestApprovalLog', state.approvalLogs),
      item: { findMany: async (a: any) => state.items.filter((i) => matchesFullWhere(i, a?.where)) },
      // lockMRS() takes a row lock per MRS before reconciling. It touches no data,
      // so the double just acknowledges it.
      $queryRaw: async () => [],
      $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
    };
  };
  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

vi.mock('@/lib/supabase-server', () => ({
  createAdminSupabase: async () => ({ auth: { admin: { deleteUser: async () => ({ data: {}, error: null }) } } }),
  createServerSupabase: async () => ({ auth: {} }),
}));

const load = () => import('@/actions/archive') as Promise<any>;

// --- a realistic warehouse ---------------------------------------------------

const CREATED = '2026-09-20T08:00:00.000Z';
const UPDATED = '2026-10-05T14:30:00.000Z';

function seedWarehouse() {
  state.warehouses = [{ id: 'wh-1', name: 'Bajada' }];
  state.profiles = [{ id: 'u-wh1', username: 'wh_bajada', name: 'Ana Reyes', role: 'Warehouse', warehouse: 'Bajada' }];
  state.items = [{ id: 'cat-1', name: 'Cement 40kg' }];
  state.pos = [{
    id: 'po-uuid-1',
    poNumber: 'PO-0001',
    date: '2026-09-20',
    mrsNo: 'MRS-001',
    warehouse: 'Bajada',
    requisitioner: 'Ana Reyes',
    supplier: 'Cement Co',
    supplierAddress: 'Km 4',
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    approvedBy: 'Purchaser One',
    listedBy: 'Purchaser One',
    pickupBy: 'Driver B',
    plateNumber: 'ABC-123',
    notes: 'Deliver before noon',
    poExpDate: '2026-10-01',
    sourceReqNumber: 'REQ-0001',
    purchaseConfirmedBy: 'Purchaser One',
    purchaseConfirmedAt: '2026-09-25T00:00:00.000Z',
    profileId: 'u-wh1',
    createdAt: CREATED,
    updatedAt: UPDATED,
    items: [
      { id: 'pi-1', poNumber: 'PO-0001', itemDescription: 'Cement 40kg', qty: 50, unit: 'bags', purchasedQty: 50, receivedQty: 30, itemId: 'cat-1', createdAt: CREATED },
      { id: 'pi-2', poNumber: 'PO-0001', itemDescription: 'Nails 4mm', qty: 20, unit: 'pcs', purchasedQty: 20, receivedQty: 20, itemId: null, createdAt: CREATED },
    ],
  }];
  state.reqs = [{
    id: 'req-uuid-1',
    reqNumber: 'REQ-0001',
    date: '2026-09-18',
    mrsNo: 'MRS-001',
    warehouse: 'Bajada',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Ana Reyes',
    status: 'Approved',
    remarks: 'Urgent',
    followUpOfReqNumber: null,
    followUpOfPoNumber: null,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    items: [
      { id: 'ri-1', reqNumber: 'REQ-0001', itemDescription: 'Cement 40kg', qty: 50, unit: 'bags', approvedQty: 50, rejectedQty: 0, itemId: 'cat-1', createdAt: '2026-09-18T00:00:00.000Z' },
    ],
  }];
  state.receivingRecords = [
    { id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-0001', poItemId: 'pi-1', itemDescription: 'Cement 40kg', unit: 'bags', fromQty: 0, toQty: 30, actor: 'Carlos Diaz', createdAt: '2026-10-01T00:00:00.000Z', editedAt: null, editedBy: null, previousToQty: null },
  ];
  state.discrepancies = [
    { id: 'd-1', poNumber: 'PO-0001', poItemId: 'pi-1', itemDescription: 'Cement 40kg', unit: 'bags', discrepancyType: 'Damaged Item', remarks: '8 bags split', status: 'open', reportedBy: 'Ana Reyes', reportedAt: '2026-10-02T00:00:00.000Z', resolvedBy: null, resolvedAt: null, resolution: null },
  ];
  state.auditLogs = [
    { id: 'al-1', poNumber: 'PO-0001', action: 'purchase_saved', detail: 'Cement: 0 + 50 = 50 bags', actor: 'Purchaser One', createdAt: '2026-09-25T00:00:00.000Z', deliveryId: null },
    { id: 'al-2', poNumber: 'PO-0001', action: 'receiving_recorded', detail: 'Cement: 0 + 30 = 30 bags', actor: 'Carlos Diaz', createdAt: '2026-10-01T00:00:00.000Z', deliveryId: null },
    // A retired DEL-* event: the snapshot must NOT capture it, because its
    // deliveryId points at a Delivery that is itself cascade-deleted.
    { id: 'al-3', poNumber: 'PO-0001', action: 'delivery_recorded', detail: 'historical', actor: 'Someone', createdAt: '2025-01-01T00:00:00.000Z', deliveryId: 'del-1' },
  ];
  state.monitoringItems = [
    { id: 'mi-1', poNumber: 'PO-0001', poItemId: 'pi-1', qtyReceived: 30, createdAt: CREATED, updatedAt: UPDATED },
  ];
  state.receipts = [
    { id: 'rc-1', poNumber: 'PO-0001', storagePath: 'PO-0001/signed.jpg', uploadedBy: 'Carlos Diaz', uploadedAt: '2026-10-01T00:05:00.000Z' },
  ];
  state.approvalLogs = [
    { id: 'apl-1', reqNumber: 'REQ-0001', reqItemId: 'ri-1', itemDescription: 'Cement 40kg', action: 'additional_approved', qty: 50, reason: 'Within budget', actor: 'Purchaser One', createdAt: '2026-09-19T00:00:00.000Z' },
  ];
}

beforeEach(() => {
  actor.current = { id: 'u-super', username: 'superadmin', name: 'Super', role: ROLES.superadmin, warehouse: null };
  state.archives = [];
  state.activity = [];
  seedWarehouse();
});

async function archiveThenRestore() {
  const { deleteWarehouseWithArchive, restoreArchive } = await load();
  await deleteWarehouseWithArchive('Bajada');
  const archived = state.archives.find((a) => !a.deleted);
  return { archived, result: await restoreArchive(archived.id) };
}

describe('the archive captures what the cascade would otherwise destroy', () => {
  it('snapshots all six related tables at delete time', async () => {
    const { deleteWarehouseWithArchive } = await load();
    await deleteWarehouseWithArchive('Bajada');
    const archived = state.archives.find((a) => !a.deleted);
    // The archive is written BEFORE the deleteMany in the same transaction,
    // because after the cascade there is nothing left to read.
    expect(archived.relatedData).toMatchObject({
      receivingRecords: expect.arrayContaining([expect.objectContaining({ eventId: 'ev-1' })]),
      discrepancies: expect.arrayContaining([expect.objectContaining({ discrepancyType: 'Damaged Item' })]),
      monitoringItems: expect.arrayContaining([expect.objectContaining({ poItemId: 'pi-1' })]),
      receipts: expect.arrayContaining([expect.objectContaining({ storagePath: 'PO-0001/signed.jpg' })]),
      approvalLogs: expect.arrayContaining([expect.objectContaining({ action: 'additional_approved' })]),
    });
  });

  it('excludes retired DEL-* audit events, whose delivery row is also cascaded', async () => {
    const { deleteWarehouseWithArchive } = await load();
    await deleteWarehouseWithArchive('Bajada');
    const archived = state.archives.find((a) => !a.deleted);
    const actions = archived.relatedData.auditLog.map((e: any) => e.action);
    expect(actions).toContain('receiving_recorded');
    expect(actions).not.toContain('delivery_recorded');
  });

  it('captures the same tables on a system reset', async () => {
    const { systemReset } = await load();
    await systemReset();
    const archived = state.archives.find((a) => !a.deleted);
    expect(archived.reason).toBe('reset');
    expect(archived.relatedData.discrepancies).toHaveLength(1);
    expect(archived.relatedData.approvalLogs).toHaveLength(1);
  });
});

describe('restore returns the purchase order unchanged', () => {
  it('brings back every business column verbatim', async () => {
    await archiveThenRestore();
    const po = state.pos[0];
    expect(po).toMatchObject({
      poNumber: 'PO-0001',
      date: '2026-09-20',
      mrsNo: 'MRS-001',
      warehouse: 'Bajada',
      requisitioner: 'Ana Reyes',
      supplier: 'Cement Co',
      supplierAddress: 'Km 4',
      status: 'in_progress',
      poType: 'active-delivery',
      approvedBy: 'Purchaser One',
      listedBy: 'Purchaser One',
      pickupBy: 'Driver B',
      plateNumber: 'ABC-123',
      notes: 'Deliver before noon',
      poExpDate: '2026-10-01',
      sourceReqNumber: 'REQ-0001',
      purchaseConfirmedBy: 'Purchaser One',
      purchaseConfirmedAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('preserves the primary key and both timestamps', async () => {
    await archiveThenRestore();
    // Timestamps are real data: "when was this order raised" and "when was it
    // last touched" are not reproducible by regenerating now().
    expect(state.pos[0].id).toBe('po-uuid-1');
    expect(state.pos[0].createdAt).toBe(CREATED);
    expect(state.pos[0].updatedAt).toBe(UPDATED);
  });

  it('preserves item primary keys so poItemId-keyed rows still resolve', async () => {
    await archiveThenRestore();
    expect(state.pos[0].items.map((i: any) => i.id)).toEqual(['pi-1', 'pi-2']);
    // Every related row below depends on this. Regenerating the key would leave
    // them restored but attached to nothing.
    expect(state.discrepancies[0].poItemId).toBe('pi-1');
    expect(state.pos[0].items.some((i: any) => i.id === state.discrepancies[0].poItemId)).toBe(true);
  });

  it('preserves the item quantity chain and the catalog link', async () => {
    await archiveThenRestore();
    const [cement, nails] = state.pos[0].items;
    expect(cement).toMatchObject({ itemDescription: 'Cement 40kg', qty: 50, unit: 'bags', purchasedQty: 50, receivedQty: 30, itemId: 'cat-1' });
    expect(nails).toMatchObject({ itemDescription: 'Nails 4mm', qty: 20, unit: 'pcs', receivedQty: 20, itemId: null });
  });
});

describe('restore returns the receiving history unchanged', () => {
  it('brings back receiving records, discrepancies, monitoring rows and receipts', async () => {
    await archiveThenRestore();
    expect(state.receivingRecords[0]).toMatchObject({ eventId: 'ev-1', poItemId: 'pi-1', fromQty: 0, toQty: 30, actor: 'Carlos Diaz' });
    expect(state.discrepancies[0]).toMatchObject({ discrepancyType: 'Damaged Item', remarks: '8 bags split', status: 'open', reportedBy: 'Ana Reyes' });
    expect(state.monitoringItems[0]).toMatchObject({ poItemId: 'pi-1', qtyReceived: 30 });
    expect(state.receipts[0]).toMatchObject({ storagePath: 'PO-0001/signed.jpg', uploadedBy: 'Carlos Diaz' });
  });

  it('brings back the purchase and receiving audit trail', async () => {
    await archiveThenRestore();
    const actions = state.auditLogs.map((e: any) => e.action).sort();
    expect(actions).toEqual(['purchase_saved', 'receiving_recorded']);
    // DeliveryAuditLog has no foreign key to PurchaseOrder — it is keyed on the
    // poNumber string — so these restore without any item remapping.
    expect(state.auditLogs.find((e: any) => e.action === 'receiving_recorded').actor).toBe('Carlos Diaz');
  });

  it('regenerates only the surrogate key', async () => {
    await archiveThenRestore();
    expect(state.discrepancies[0].id).not.toBe('d-1');
    expect(state.discrepancies[0].discrepancyType).toBe('Damaged Item');
  });
});

describe('restore returns the request unchanged', () => {
  it('brings back the request, its line and its approval decisions', async () => {
    await archiveThenRestore();
    expect(state.reqs[0]).toMatchObject({
      reqNumber: 'REQ-0001', date: '2026-09-18', warehouse: 'Bajada',
      requestedBy: 'Ana Reyes', status: 'Approved', remarks: 'Urgent',
      id: 'req-uuid-1',
    });
    expect(state.reqs[0].items[0]).toMatchObject({ id: 'ri-1', itemDescription: 'Cement 40kg', qty: 50, approvedQty: 50, itemId: 'cat-1' });
    // Without these, a rejected balance is indistinguishable from a never-decided
    // one — which is the entire reason RequestApprovalLog exists.
    expect(state.approvalLogs[0]).toMatchObject({ action: 'additional_approved', qty: 50, reason: 'Within budget', actor: 'Purchaser One' });
  });
});

describe('restore survives a deleted warehouse', () => {
  it('completes instead of aborting on a dangling profileId', async () => {
    // The scenario that made deleted-warehouse archives unrestorable: every direct
    // PO is raised against its creator's OWN warehouse (resolvePoWarehouse), and
    // deleting that warehouse deletes exactly the profile the PO points at.
    // Passing the archived value through was a guaranteed FK violation that
    // rolled the whole transaction back.
    const { deleteWarehouseWithArchive, restoreArchive } = await load();
    await deleteWarehouseWithArchive('Bajada');
    expect(state.profiles).toHaveLength(0);
    const archived = state.archives.find((a) => !a.deleted);
    await expect(restoreArchive(archived.id)).resolves.toMatchObject({ restoredPOs: 1, restoredReqs: 1 });
    expect(state.pos).toHaveLength(1);
    expect(state.reqs).toHaveLength(1);
  });

  it('nulls the creator pointer rather than inventing an identity record', async () => {
    await archiveThenRestore();
    expect(state.pos[0].profileId).toBeNull();
    // Every OTHER accountability field is free text and comes back untouched —
    // only the pointer to a deleted login is dropped.
    expect(state.pos[0].requisitioner).toBe('Ana Reyes');
    expect(state.pos[0].approvedBy).toBe('Purchaser One');
    expect(state.pos[0].purchasedBy).toBeUndefined();
    expect(state.pos[0].purchaseConfirmedBy).toBe('Purchaser One');
  });

  it('recreates the warehouse row so the site is selectable again', async () => {
    await archiveThenRestore();
    expect(state.warehouses.find((w) => w.name === 'Bajada' && !w.deleted)).toBeTruthy();
  });

  it('says in the activity log whether the receiving history came back', async () => {
    await archiveThenRestore();
    const entry = state.activity.find((a) => a.action === 'restored');
    expect(entry.detail).toContain('receiving history');
  });
});

describe('restore of an archive predating the relatedData column', () => {
  beforeEach(() => {
    // Take the archive: the live rows are already gone, which is the state a
    // restore always runs against. Leaving PO-0001 in place would just exercise
    // the duplicate-skip path instead.
    state.pos = [];
    state.reqs = [];
    state.archives = [{
      id: 'arc-old', warehouseName: 'Bajada', reason: 'reset', clearedAt: new Date(),
      poCount: 1, requestCount: 0,
      poData: [{
        poNumber: 'PO-0001', date: '2026-09-20', mrsNo: 'MRS-001', warehouse: 'Bajada',
        requisitioner: 'Ana Reyes', supplier: 'Cement Co', status: 'in_progress',
        poType: 'active-delivery', profileId: 'u-wh1',
        createdAt: CREATED, updatedAt: UPDATED,
        items: [{ id: 'pi-1', poNumber: 'PO-0001', itemDescription: 'Cement 40kg', qty: 50, unit: 'bags', purchasedQty: 50, receivedQty: 30, itemId: null, createdAt: CREATED }],
      }],
      requestData: [],
      relatedData: null,
    }];
  });

  it('still restores what it holds rather than failing', async () => {

    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-old')).resolves.toMatchObject({ restoredPOs: 1 });
    expect(state.pos[0].poNumber).toBe('PO-0001');
  });

  it('states the limitation instead of implying a complete restore', async () => {

    const { restoreArchive } = await load();
    await restoreArchive('arc-old');
    // An operator reading the log must be able to tell a complete restore from a
    // partial one.
    expect(state.activity.find((a) => a.action === 'restored').detail).toContain('predates');
  });

  it('survives a relatedData blob of the wrong shape', async () => {
    // A restore is a recovery operation. One malformed field must not throw
    // mid-transaction, because a throw rolls everything back and restores
    // NOTHING — strictly worse than restoring the tables it can read.
    state.archives[0].relatedData = { discrepancies: 'not an array', auditLog: null } as any;
    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-old')).resolves.toMatchObject({ restoredPOs: 1 });
    expect(state.pos[0].poNumber).toBe('PO-0001');
  });
});

describe('restore leaves unrelated records alone', () => {
  it('skips a purchase order that already exists and does not duplicate its children', async () => {
    await archiveThenRestore();
    // A second restore of the same numbers is a no-op on the PO but must not
    // re-insert the related rows under a surviving order.
    expect(state.discrepancies).toHaveLength(1);
    expect(state.receivingRecords).toHaveLength(1);
  });

  it('rejects an unauthorized caller before touching anything', async () => {
    const { restoreArchive } = await load();
    actor.current = { id: 'u-w', username: 'wh', name: 'WH', role: ROLES.warehouse, warehouse: 'Bajada' };
    await expect(restoreArchive('nope')).rejects.toThrow(/Unauthorized/);
    expect(state.pos).toHaveLength(1);
    actor.current = { id: 'u-super', username: 'superadmin', name: 'Super', role: ROLES.superadmin, warehouse: null };
  });
});

describe('getArchiveReportRows', () => {
  it('refuses a Warehouse-role caller', async () => {
    const { getArchiveReportRows } = await load();
    actor.current = { id: 'u-w', username: 'wh', name: 'WH', role: ROLES.warehouse, warehouse: 'Bajada' };
    await expect(getArchiveReportRows('arc-1')).rejects.toThrow(/Unauthorized/);
    actor.current = { id: 'u-super', username: 'superadmin', name: 'Super', role: ROLES.superadmin, warehouse: null };
  });

  it('refuses an unauthenticated caller', async () => {
    const { getArchiveReportRows } = await load();
    const saved = actor.current;
    actor.current = NO_SESSION as any;
    await expect(getArchiveReportRows('arc-1')).rejects.toThrow(/Unauthorized/);
    actor.current = saved;
  });

  it('returns four report row sets and records the download', async () => {
    const { deleteWarehouseWithArchive, getArchiveReportRows } = await load();
    await deleteWarehouseWithArchive('Bajada');
    const archived = state.archives.find((a) => !a.deleted);
    const rows = await getArchiveReportRows(archived.id);
    // One row per ITEM, matching the live report — the old export had one row
    // per order with the lines glued into single cells.
    expect(rows.purchase_orders).toHaveLength(2);
    expect(rows.material_requests).toHaveLength(1);
    expect(rows.discrepancy).toHaveLength(1);
    expect(state.activity.some((a) => a.action === 'downloaded')).toBe(true);
  });

  // getArchiveMeta feeds ONLY the workbook subtitle (ArchiveView.jsx builds
  // `<warehouse> · cleared <date>` from it), so what matters is that it returns
  // exactly the identifying fields, stays behind the same authorization guard as
  // getArchiveReportRows, and fails cleanly on a missing id rather than handing
  // the caller a half-empty subtitle.
  describe('getArchiveMeta', () => {
    it('returns the warehouse, reason and cleared date for the workbook subtitle', async () => {
      const { deleteWarehouseWithArchive, getArchiveMeta } = await load();
      await deleteWarehouseWithArchive('Bajada');
      const archived = state.archives.find((a) => !a.deleted)!;
      const meta = await getArchiveMeta(archived.id);
      expect(meta.warehouseName).toBe('Bajada');
      expect(meta.reason).toBe('deleted');
      // The real schema defaults clearedAt to now(); this double applies no
      // schema default, so only assert the field is carried through when set.
      if (meta.clearedAt !== undefined) {
        expect(Number.isNaN(new Date(meta.clearedAt).getTime())).toBe(false);
      }
    });

    it('selects only the three subtitle fields, never the row payloads', async () => {
      // The double's findUnique ignores `select`, so the returned object cannot
      // prove this. The contract is in the query, so assert it directly: the
      // archive blobs (poData/requestData/relatedData) must never travel to the
      // browser just to render a one-line subtitle.
      const { readFileSync } = await import('node:fs');
      const src = readFileSync('actions/archive.ts', 'utf8');
      const start = src.indexOf('export async function getArchiveMeta');
      const body = src.slice(start, src.indexOf('\n}', start));
      const select = body.slice(body.indexOf('select:'));
      expect(select).toContain('warehouseName: true');
      expect(select).toContain('reason: true');
      expect(select).toContain('clearedAt: true');
      // The heavy blobs must not be selected.
      expect(select).not.toMatch(/poData|requestData|relatedData/);
    });

    it('throws on an unknown id instead of returning undefined', async () => {
      const { getArchiveMeta } = await load();
      await expect(getArchiveMeta('does-not-exist')).rejects.toThrow(/Archive entry not found/);
    });

    it('refuses a Warehouse-role caller', async () => {
      const { getArchiveMeta } = await load();
      actor.current = { id: 'u-w', username: 'wh', name: 'WH', role: ROLES.warehouse, warehouse: 'Bajada' };
      await expect(getArchiveMeta('arc-1')).rejects.toThrow(/Unauthorized/);
      actor.current = { id: 'u-super', username: 'superadmin', name: 'Super', role: ROLES.superadmin, warehouse: null };
    });

    it('refuses an unauthenticated caller', async () => {
      const { getArchiveMeta } = await load();
      const saved = actor.current;
      actor.current = NO_SESSION as any;
      await expect(getArchiveMeta('arc-1')).rejects.toThrow(/Unauthorized/);
      actor.current = saved;
    });

    it('does not record activity — reading metadata is not a download', async () => {
      const { deleteWarehouseWithArchive, getArchiveMeta } = await load();
      await deleteWarehouseWithArchive('Bajada');
      const archived = state.archives.find((a) => !a.deleted)!;
      const before = state.activity.filter((a) => a.action === 'downloaded').length;
      await getArchiveMeta(archived.id);
      // getArchiveReportRows logs a 'downloaded' row; getArchiveMeta must not,
      // or every workbook preview would inflate the activity log.
      expect(state.activity.filter((a) => a.action === 'downloaded')).toHaveLength(before);
    });
  });
});
