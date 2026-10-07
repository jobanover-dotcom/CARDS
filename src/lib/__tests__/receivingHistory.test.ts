import { beforeEach, describe, expect, it, vi } from 'vitest';

// Receiving history, and correcting the latest event on it.
//
// Two things are being pinned here.
//
// 1. THE HISTORY IS STRUCTURED. DeliveryAuditLog.detail is prose —
//    "Cement: 0 + 30 = 30 bags" — which reads fine in a list but holds nothing a
//    correction can be applied to. ReceivingRecord carries the per-line numbers.
//
// 2. AN EDIT IS THE ONLY PATH THAT MAY LOWER A TOTAL. recordReceiving refuses to
//    reduce a received quantity, which is right for recording new arrivals: goods
//    cannot un-arrive. Correcting a miscount is the opposite case. The floor is
//    the event's own fromQty, so a correction can never quietly undo a whole
//    earlier delivery.
//
// No database and no credentials are involved.

const actor = vi.hoisted(() => ({
  current: { id: 'w1', username: 'wh1', role: 'Warehouse', warehouse: 'MAIN' as string | null },
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

const db = vi.hoisted(() => ({
  pos: [] as any[],
  records: [] as any[],
  audit: [] as any[],
  writes: {
    itemUpdate: null as null | ((a: any) => any),
    poUpdate: null as null | ((a: any) => any),
    recordCreate: null as null | ((a: any) => any),
    recordUpdate: null as null | ((a: any) => any),
    lock: null as null | (() => number),
  },
}));

let seq = 0;

function tx() {
  return {
    purchaseOrder: {
      findUnique: async (args: any) => {
        const where = args?.where ?? {};
        const po = db.pos.find((p) => p.poNumber === where.poNumber);
        if (!po) return null;
        return args?.select ? { ...po } : { ...po, items: po.items };
      },
      // buildPOChains reads the source request through this, so it has to exist
      // even though these tests are only about receiving.
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let out = db.pos;
        if (where.mrsNo) out = out.filter((p) => p.mrsNo === where.mrsNo);
        if (where.poNumber) out = out.filter((p) => p.poNumber === where.poNumber);
        return [...out];
      },
      update: async (args: any) => {
        db.writes.poUpdate?.(args);
        const po = db.pos.find((p) => p.poNumber === args.where.poNumber);
        if (po) Object.assign(po, args.data);
        return po;
      },
    },
    warehouseRequest: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
    },
    purchaseOrderItem: {
      update: async (args: any) => {
        db.writes.itemUpdate?.(args);
        // Applied to the fixture, so a settled correction really moves the
        // balances rather than only appearing to.
        for (const po of db.pos) {
          const item = (po.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return { ...args.data };
      },
    },
    receivingRecord: {
      create: async (args: any) => {
        db.writes.recordCreate?.(args);
        const row = { id: `rr-${++seq}`, createdAt: new Date('2026-10-07T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null, ...args.data };
        db.records.push(row);
        return row;
      },
      findMany: async (args: any = {}) => {
        let rows = db.records.filter((r) => !args.where || r.poNumber === args.where.poNumber);
        if (args.where?.eventId) rows = rows.filter((r) => r.eventId === args.where.eventId);
        const ordered = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return ordered;
      },
      findFirst: async (args: any = {}) => {
        const rows = db.records.filter((r) => r.poNumber === args.where?.poNumber);
        return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      },
      update: async (args: any) => {
        db.writes.recordUpdate?.(args);
        const row = db.records.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
    },
    deliveryAuditLog: {
      create: async (args: any) => {
        db.audit.push(args.data);
        return { id: `audit-${db.audit.length}`, ...args.data };
      },
      findMany: async () => db.audit,
    },
    $queryRaw: async () => {
      db.writes.lock?.();
      return [];
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: tx(),
  runTx: async (fn: any) => fn(tx()),
}));

function po(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    supplier: 'Supplier A',
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    items: [
      { id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 40, receivedQty: 0 },
    ],
    ...over,
  };
}

function load() {
  return import('@/actions/procurement') as Promise<any>;
}

beforeEach(() => {
  seq = 0;
  actor.current = { id: 'w1', username: 'wh1', role: 'Warehouse', warehouse: 'MAIN' };
  db.pos = [];
  db.records = [];
  db.audit = [];
  db.writes = { itemUpdate: null, poUpdate: null, recordCreate: null, recordUpdate: null, lock: null };
});

describe('recordReceiving writes structured history', () => {
  it('records the cumulative bounds of each arrival', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', receivedQty: 30 }],
    });

    expect(db.records).toHaveLength(1);
    expect(db.records[0]).toMatchObject({
      poNumber: 'PO-001',
      poItemId: 'pi-1',
      itemDescription: 'Cement',
      unit: 'bags',
      // The bounds are what make a later correction safe: fromQty is the floor.
      fromQty: 0,
      toQty: 30,
      actor: 'wh1',
    });
  });

  it('gives every line of one save a shared event id', async () => {
    db.pos = [
      po({
        items: [
          { id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 40, receivedQty: 0 },
          { id: 'pi-2', itemDescription: 'Nails', unit: 'boxes', qty: 50, purchasedQty: 45, receivedQty: 0 },
        ],
      }),
    ];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        { poItemId: 'pi-1', receivedQty: 30 },
        { poItemId: 'pi-2', receivedQty: 40 },
      ],
    });

    // Two lines, one event — so the history groups them without relying on two
    // rows sharing a timestamp.
    expect(db.records).toHaveLength(2);
    expect(db.records[0].eventId).toBe(db.records[1].eventId);
  });

  it('records a second arrival against the total already standing', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', receivedQty: 30 }] });
    await recordReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', receivedQty: 40 }] });

    expect(db.records).toHaveLength(2);
    expect(db.records[1]).toMatchObject({ fromQty: 30, toQty: 40 });
    // A distinct event, so the later one is the editable one.
    expect(db.records[1].eventId).not.toBe(db.records[0].eventId);
  });

  it('writes no history when nothing changed', async () => {
    db.pos = [po({ items: [{ id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 40, receivedQty: 30 }] })];
    const { recordReceiving } = await load();

    await recordReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', receivedQty: 30 }] });

    // Re-saving an unchanged total is not an event, so the history does not
    // accumulate empty rows every time the form is submitted.
    expect(db.records).toEqual([]);
  });
});

describe('getReceivingHistory', () => {
  beforeEach(() => {
    db.pos = [po()];
    db.records = [
      { id: 'rr-1', eventId: 'e1', poNumber: 'PO-001', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, actor: 'wh1', createdAt: new Date('2026-10-01T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null },
      { id: 'rr-2', eventId: 'e2', poNumber: 'PO-001', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 30, toQty: 40, actor: 'wh1', createdAt: new Date('2026-10-02T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null },
    ];
  });

  it('returns events newest first with the arrival as a delta', async () => {
    const { getReceivingHistory } = await load();

    const events = await getReceivingHistory('PO-001');

    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe('e2');
    expect(events[0].lines[0]).toMatchObject({ fromQty: 30, toQty: 40, delta: 10, edited: false });
    expect(events[1].lines[0].delta).toBe(30);
  });

  it('marks only the newest event editable', async () => {
    const { getReceivingHistory } = await load();

    const events = await getReceivingHistory('PO-001');

    // Editing an earlier event would invalidate every delivery recorded after it.
    expect(events[0].editable).toBe(true);
    expect(events[1].editable).toBe(false);
  });

  it('surfaces a corrected event as edited, with the figure it was given', async () => {
    db.records[1].editedAt = new Date('2026-10-03T10:00:00Z');
    db.records[1].editedBy = 'wh2';
    db.records[1].previousToQty = 35;
    db.records[1].toQty = 32;
    const { getReceivingHistory } = await load();

    const events = await getReceivingHistory('PO-001');

    // The history shows what changed, not only what it now says.
    expect(events[0].lines[0]).toMatchObject({ edited: true, editedBy: 'wh2', previousToQty: 35, toQty: 32 });
  });

  it('refuses a purchase order belonging to another warehouse', async () => {
    actor.current = { id: 'w2', username: 'wh2', role: 'Warehouse', warehouse: 'OTHER' };
    const { getReceivingHistory } = await load();

    await expect(getReceivingHistory('PO-001')).rejects.toThrow(/Unauthorized/);
  });
});

describe('editLatestReceiving', () => {
  /** One event: 30 recorded against a 40 purchase, so 10 remain outstanding. */
  async function staged() {
    db.pos = [po()];
    db.records = [
      { id: 'rr-1', eventId: 'e1', poNumber: 'PO-001', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, actor: 'wh1', createdAt: new Date('2026-10-01T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null },
    ];
  }

  const edit = (toQty: number) => ({
    poNumber: 'PO-001',
    items: [{ poItemId: 'pi-1', toQty }],
  });

  it('corrects a miscount downward and keeps the original figure visible', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    // Recorded 30, actually 25.
    await editLatestReceiving(edit(25));

    expect(db.records[0].toQty).toBe(25);
    // What it first said is kept, so the correction is visible rather than silent.
    expect(db.records[0].previousToQty).toBe(30);
    expect(db.records[0].editedBy).toBe('wh1');
    expect(db.records[0].editedAt).toBeTruthy();
    // And the live quantity follows.
    expect(db.pos[0].items[0].receivedQty).toBe(25);
  });

  it('corrects a miscount upward too', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    await editLatestReceiving(edit(35));

    expect(db.records[0].toQty).toBe(35);
    expect(db.pos[0].items[0].receivedQty).toBe(35);
  });

  it('preserves the FIRST recorded figure across a second correction', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    await editLatestReceiving(edit(25));
    await editLatestReceiving(edit(28));

    // previousToQty must not become 25 — that was itself an edit, not what was
    // originally recorded.
    expect(db.records[0].previousToQty).toBe(30);
    expect(db.records[0].toQty).toBe(28);
  });

  it('refuses to correct below what was already received before that event', async () => {
    // A second event that raised the total to 40: its floor is 30, so the
    // correction cannot drop under the earlier delivery.
    db.pos = [po({ items: [{ id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 40, receivedQty: 40 }] })];
    db.records = [
      { id: 'rr-1', eventId: 'e1', poNumber: 'PO-001', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, actor: 'wh1', createdAt: new Date('2026-10-01T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null },
      { id: 'rr-2', eventId: 'e2', poNumber: 'PO-001', poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 30, toQty: 40, actor: 'wh1', createdAt: new Date('2026-10-02T10:00:00Z'), editedAt: null, editedBy: null, previousToQty: null },
    ];
    const { editLatestReceiving } = await load();
    let wrote = false;
    db.writes.itemUpdate = () => { wrote = true; };
    db.writes.recordUpdate = () => { wrote = true; };

    await expect(editLatestReceiving(edit(29))).rejects.toThrow(/cannot be corrected below the 30/);

    expect(wrote).toBe(false);
    expect(db.records[1].toQty).toBe(40);
  });

  it('refuses a correction beyond the purchased quantity', async () => {
    await staged();
    const { editLatestReceiving } = await load();
    let wrote = false;
    db.writes.itemUpdate = () => { wrote = true; };

    await expect(editLatestReceiving(edit(41))).rejects.toThrow(/cannot exceed the purchased quantity of 40/);

    expect(wrote).toBe(false);
    expect(db.records[0].toQty).toBe(30);
  });

  it('refuses a line that is not part of the latest event', async () => {
    await staged();
    // A line recorded in the same event, but on a PO item that no longer exists.
    // The event is the latest, so the line belongs to it — the failure has to come
    // from the item lookup, not the event check.
    db.pos[0].items.push({ id: 'pi-2', itemDescription: 'Nails', unit: 'boxes', qty: 50, purchasedQty: 45, receivedQty: 5 });
    db.records.push({
      id: 'rr-2',
      eventId: 'e1',
      poNumber: 'PO-001',
      poItemId: 'pi-2',
      itemDescription: 'Nails',
      unit: 'boxes',
      fromQty: 0,
      toQty: 5,
      actor: 'wh1',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      editedAt: null,
      editedBy: null,
      previousToQty: null,
    });
    const { editLatestReceiving } = await load();

    await expect(
      editLatestReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-999', toQty: 9 }] }),
    ).rejects.toThrow(/most recent receiving event/);
  });

  it('writes an audit entry naming what changed', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    await editLatestReceiving(edit(25));

    const entry = db.audit.find((e) => e.action === 'receiving_edited');
    expect(entry).toBeTruthy();
    expect(entry.detail).toContain('Cement');
    expect(entry.detail).toContain('30');
    expect(entry.detail).toContain('25');
    expect(entry.actor).toBe('wh1');
  });

  it('reads the balance under the PO row lock', async () => {
    await staged();
    let locks = 0;
    db.writes.lock = () => { locks += 1; };
    const { editLatestReceiving } = await load();

    await editLatestReceiving(edit(25));

    // The floor and the purchased ceiling are only sound if the rows are read
    // after the lock is taken.
    expect(locks).toBeGreaterThan(0);
  });

  it('refuses a purchaser, and a warehouse from another site', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    actor.current = { id: 'p', username: 'purchaser1', role: 'Admin', warehouse: null };
    await expect(editLatestReceiving(edit(25))).rejects.toThrow(/only warehouse users/);

    actor.current = { id: 'w2', username: 'wh2', role: 'Warehouse', warehouse: 'OTHER' };
    await expect(editLatestReceiving(edit(25))).rejects.toThrow(/Unauthorized/);

    expect(db.records[0].toQty).toBe(30);
  });

  it('refuses when there is no receiving history to correct', async () => {
    db.pos = [po()];
    db.records = [];
    const { editLatestReceiving } = await load();

    await expect(editLatestReceiving(edit(25))).rejects.toThrow(/no receiving history/);
  });

  it('rejects a fractional or negative total', async () => {
    await staged();
    const { editLatestReceiving } = await load();

    await expect(
      editLatestReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', toQty: 25.5 }] }),
    ).rejects.toThrow();
    await expect(
      editLatestReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', toQty: -1 }] }),
    ).rejects.toThrow();
    expect(db.records[0].toQty).toBe(30);
  });
});