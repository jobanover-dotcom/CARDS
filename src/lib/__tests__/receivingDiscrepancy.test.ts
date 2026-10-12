/**
 * Item-level receiving discrepancies.
 *
 * The point of this feature is a boundary between two things that used to be
 * blurred: a delivery that is merely INCOMPLETE, and a delivery that is WRONG.
 *
 *   Purchased 50, Received 40          -> receiving outstanding. Not a
 *                                        discrepancy. Nothing is written.
 *   Purchased 50, 1 damaged, so 49     -> 49 received PLUS a Damaged Item
 *                                        report on the nails.
 *
 * So the property under test throughout is that a discrepancy only ever exists
 * because somebody explicitly reported one, and that reporting one changes no
 * quantity. There is deliberately no damagedQty, no wrongItemQty, no
 * rejectedReceivedQty anywhere in this suite — the received figure is the whole
 * of the quantity story, and the report says what was wrong with the rest.
 *
 * No database and no credentials are involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actor = vi.hoisted(() => ({
  current: { id: 'w1', username: 'wh1', role: 'Warehouse', warehouse: 'MAIN' as string | null },
}));

vi.mock('@/actions/auth', () => ({
  getCurrentUser: async () => actor.current,
  getSession: async () => null,
  login: async () => ({ error: 'not available in tests' }),
  logout: async () => ({ success: true }),
  changePassword: async () => ({ error: 'not available in tests' }),
  adminResetPassword: async () => ({ error: 'not available in tests' }),
  getProfileByUsername: async () => null,
}));

const db = vi.hoisted(() => ({
  pos: [] as any[],
  records: [] as any[],
  discrepancies: [] as any[],
  audit: [] as any[],
  writes: {
    itemUpdate: null as null | ((a: any) => any),
    poUpdate: null as null | ((a: any) => any),
    discrepancyCreate: null as null | ((a: any) => any),
    discrepancyUpdate: null as null | ((a: any) => any),
    lock: null as null | (() => number),
  },
}));

let seq = 0;
let now = new Date('2026-10-07T12:00:00Z');

function tx() {
  return {
    purchaseOrder: {
      findUnique: async (args: any) => {
        const po = db.pos.find((p) => p.poNumber === (args?.where ?? {}).poNumber);
        if (!po) return null;
        return args?.select ? { ...po } : { ...po, items: po.items };
      },
      findMany: async (args: any = {}) => {
        const where = args?.where ?? {};
        let out = db.pos;
        if (where.mrsNo) out = out.filter((p) => p.mrsNo === where.mrsNo?.in?.[0] || p.mrsNo === where.mrsNo);
        if (where.poNumber) {
          const wanted = where.poNumber.in ?? [where.poNumber];
          out = out.filter((p) => wanted.includes(p.poNumber));
        }
        // The MRS read projects open discrepancy rows alongside the POs.
        if (args?.include?.receivingDiscrepancies) {
          return out.map((p) => ({
            ...p,
            items: p.items,
            deliveries: args.include.deliveries ? [] : undefined,
            receivingDiscrepancies: db.discrepancies
              .filter((d) => d.poNumber === p.poNumber && d.status === 'open')
              .map((d) => ({ poItemId: d.poItemId })),
          }));
        }
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
        for (const p of db.pos) {
          const item = (p.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return { ...args.data };
      },
    },
    receivingRecord: {
      create: async (args: any) => {
        const row = {
          id: `rr-${++seq}`,
          createdAt: now,
          editedAt: null,
          editedBy: null,
          previousToQty: null,
          ...args.data,
        };
        db.records.push(row);
        return row;
      },
      findMany: async (args: any = {}) => {
        let rows = db.records.filter((r) => r.poNumber === args.where?.poNumber);
        if (args.where?.eventId) rows = rows.filter((r) => r.eventId === args.where.eventId);
        return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
    receivingDiscrepancy: {
      create: async (args: any) => {
        db.writes.discrepancyCreate?.(args);
        const row = {
          id: `disc-${++seq}`,
          reportedAt: now,
          resolvedBy: null,
          resolvedAt: null,
          resolution: null,
          ...args.data,
        };
        db.discrepancies.push(row);
        return row;
      },
      findMany: async (args: any = {}) => {
        let rows = db.discrepancies;
        const w = args.where ?? {};
        if (w.poNumber) rows = rows.filter((r) => w.poNumber === r.poNumber || w.poNumber.in?.includes(r.poNumber));
        if (w.status) rows = rows.filter((r) => r.status === w.status);
        return [...rows];
      },
      findUnique: async (args: any) => {
        const row = db.discrepancies.find((r) => r.id === args.where?.id);
        return row ? { ...row } : null;
      },
      update: async (args: any) => {
        db.writes.discrepancyUpdate?.(args);
        const row = db.discrepancies.find((r) => r.id === args.where.id);
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

/** A PO with two lines, so item-level attribution has something to be wrong about. */
function po(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    supplier: 'Trust Hardware',
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    // readMRSData() orders every PO on an MRS by age, so a second PO needs a
    // later stamp to sort deterministically.
    createdAt: new Date('2026-10-01T08:00:00Z'),
    items: [
      { id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 50, receivedQty: 40 },
      { id: 'pi-2', itemDescription: 'Nails', unit: 'boxes', qty: 50, purchasedQty: 50, receivedQty: 40 },
    ],
    ...over,
  };
}

const load = () => import('@/actions/procurement') as Promise<any>;

const openFlags = () => db.discrepancies.filter((d) => d.status === 'open');
const auditFor = (action: string) => db.audit.filter((a) => a.action === action);
const item = (poNumber: string, id: string) =>
  db.pos.find((p) => p.poNumber === poNumber)!.items.find((i: any) => i.id === id);

beforeEach(() => {
  seq = 0;
  now = new Date('2026-10-07T12:00:00Z');
  actor.current = { id: 'w1', username: 'wh1', role: 'Warehouse', warehouse: 'MAIN' };
  db.pos = [];
  db.records = [];
  db.discrepancies = [];
  db.audit = [];
  db.writes = {
    itemUpdate: null,
    poUpdate: null,
    discrepancyCreate: null,
    discrepancyUpdate: null,
    lock: null,
  };
});

describe('a short delivery is not a discrepancy', () => {
  it('A — records the partial receipt and creates nothing', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    // Ten boxes short on the nails, with no problem reported at all.
    await recordReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-2', receivedQty: 49 }],
    });

    // The short receipt is recorded as a short receipt.
    expect(item('PO-001', 'pi-2').receivedQty).toBe(49);
    expect(db.records).toHaveLength(1);
    // And no exception was invented from the gap it left behind.
    expect(db.discrepancies).toHaveLength(0);
    expect(auditFor('discrepancy_reported')).toHaveLength(0);
    expect(auditFor('receiving_recorded')).toHaveLength(1);
  });

  it('never derives a discrepancy from purchasedQty > receivedQty', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    // Deliver nothing at all against both lines. Still no discrepancy.
    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        { poItemId: 'pi-1', receivedQty: 40 },
        { poItemId: 'pi-2', receivedQty: 40 },
      ],
    });

    expect(db.pos[0].totals).toBeUndefined();
    expect(db.discrepancies).toHaveLength(0);
  });
});

describe('the warehouse can report a discrepancy on a PO item', () => {
  it('B — files the report with its type, remarks, actor and status', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: 'Damaged Item', remarks: '1 box was crushed on arrival.' },
        },
      ],
    });

    expect(db.discrepancies).toHaveLength(1);
    expect(db.discrepancies[0]).toMatchObject({
      poNumber: 'PO-001',
      poItemId: 'pi-2',
      itemDescription: 'Nails',
      unit: 'boxes',
      discrepancyType: 'Damaged Item',
      remarks: '1 box was crushed on arrival.',
      status: 'open',
      reportedBy: 'wh1',
    });
    expect(db.discrepancies[0].reportedAt).toBeInstanceOf(Date);
  });

  it('C — attaches it to the flagged line only, leaving the sibling alone', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        { poItemId: 'pi-1', receivedQty: 50 },
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: 'Short Quantity' },
        },
      ],
    });

    // One flag, on the nails. The cement arrived in full and is not implicated.
    expect(db.discrepancies).toHaveLength(1);
    expect(db.discrepancies[0].poItemId).toBe('pi-2');
    expect(db.discrepancies[0].itemDescription).toBe('Nails');
    expect(openFlags().some((d) => d.poItemId === 'pi-1')).toBe(false);
  });

  it('refuses an item that belongs to another purchase order', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();
    let wrote = false;
    db.writes.discrepancyCreate = () => {
      wrote = true;
    };

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [
          { poItemId: 'someone-elses-item', receivedQty: 1, discrepancy: { type: 'Wrong Item' } },
        ],
      }),
    ).rejects.toThrow(/does not belong to this purchase order/);

    expect(wrote).toBe(false);
    expect(db.discrepancies).toHaveLength(0);
  });

  it('D — accepts a custom type that is not one of the suggestions', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    // A real answer that no fixed vocabulary would contain.
    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: '40mm bar supplied instead of 50mm', remarks: 'Measured on site.' },
        },
      ],
    });

    expect(db.discrepancies[0].discrepancyType).toBe('40mm bar supplied instead of 50mm');
  });

  it('files a report even when the quantity did not move', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    // "The fifty boxes all arrived but they are the wrong size" has no quantity
    // change to hang off, so the flag must not be tied to one.
    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 40,
          discrepancy: { type: 'Wrong Specification', remarks: 'All 40 are 40mm, not the 50mm ordered.' },
        },
      ],
    });

    expect(db.discrepancies).toHaveLength(1);
    expect(db.discrepancies[0].discrepancyType).toBe('Wrong Specification');
    // No quantity delta, so no receiving event — but the report exists.
    expect(db.records).toHaveLength(0);
    expect(item('PO-001', 'pi-2').receivedQty).toBe(40);
    expect(auditFor('discrepancy_reported')).toHaveLength(1);
  });

  it('refuses a second open report on the same line', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    const report = {
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } }],
    };
    await recordReceiving(report);

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Wrong Item' } }],
      }),
    ).rejects.toThrow(/already has an open discrepancy/);

    expect(db.discrepancies).toHaveLength(1);
  });

  it('writes its own audit line naming the item and the type', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: 'Damaged Item', remarks: '1 box crushed.' },
        },
      ],
    });

    const [entry] = auditFor('discrepancy_reported');
    expect(entry.actor).toBe('wh1');
    expect(entry.detail).toContain('Nails');
    expect(entry.detail).toContain('Damaged Item');
    expect(entry.detail).toContain('1 box crushed.');
  });
});

describe('a discrepancy introduces no quantity of its own', () => {
  it('H — damaged example: purchased 50, acceptable 49, no damagedQty anywhere', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-1',
          receivedQty: 49,
          discrepancy: { type: 'Damaged Item', remarks: '1 cement bag was damaged upon delivery.' },
        },
      ],
    });

    // The whole quantity story: 50 bought, 49 counted, 1 still to receive.
    expect(item('PO-001', 'pi-1').purchasedQty).toBe(50);
    expect(item('PO-001', 'pi-1').receivedQty).toBe(49);
    expect(50 - item('PO-001', 'pi-1').receivedQty).toBe(1);

    // The report is words, not a second number. If a parallel quantity system
    // ever grew a field, it would show up here.
    expect(Object.keys(db.discrepancies[0]).sort()).toEqual(
      [
        'discrepancyType',
        'id',
        'itemDescription',
        'poItemId',
        'poNumber',
        'remarks',
        'reportedAt',
        'reportedBy',
        'resolution',
        'resolvedAt',
        'resolvedBy',
        'status',
        'unit',
      ].sort(),
    );
    expect(db.discrepancies[0]).not.toHaveProperty('damagedQty');
    expect(db.discrepancies[0]).not.toHaveProperty('rejectedReceivedQty');
    expect(db.discrepancies[0]).not.toHaveProperty('acceptedQty');
    expect(db.items).toBeUndefined();
  });

  it('I — wrong item example: the wrong unit is simply not counted', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    // 49 correct boxes plus one that is not what was ordered.
    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: 'Wrong Item', remarks: 'One box contained screws.' },
        },
      ],
    });

    expect(item('PO-001', 'pi-2').receivedQty).toBe(49);
    expect(item('PO-001', 'pi-2').purchasedQty).toBe(50);
    expect(db.discrepancies[0]).not.toHaveProperty('wrongItemQty');
  });
});

describe('the warehouse can report, and only the warehouse can report', () => {
  it('S — refuses another warehouse', async () => {
    db.pos = [po({ warehouse: 'OTHER' })];
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } }],
      }),
    ).rejects.toThrow(/only warehouse users|another warehouse/);

    expect(db.discrepancies).toHaveLength(0);
  });

  it('refuses an admin: reporting is a receiving act', async () => {
    db.pos = [po()];
    actor.current = { id: 'a1', username: 'admin', role: 'Admin', warehouse: null };
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } }],
      }),
    ).rejects.toThrow(/only warehouse users/);

    expect(db.discrepancies).toHaveLength(0);
  });

  it('refuses a cancelled purchase order', async () => {
    db.pos = [po({ status: 'cancelled', statusLabel: 'Cancelled' })];
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } }],
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('requires a type', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();

    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [
          { poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: '   ', remarks: 'something' } },
        ],
      }),
    ).rejects.toThrow(/Discrepancy type is required/);
  });

  it('still enforces the quantity caps on a flagged line', async () => {
    db.pos = [po()];
    const { recordReceiving } = await load();
    let wrote = false;
    db.writes.discrepancyCreate = () => {
      wrote = true;
    };

    // A flag is not a licence to record an impossible count.
    await expect(
      recordReceiving({
        poNumber: 'PO-001',
        items: [
          { poItemId: 'pi-2', receivedQty: 51, discrepancy: { type: 'Damaged Item' } },
        ],
      }),
    ).rejects.toThrow(/cannot exceed the purchased quantity of 50/);

    expect(wrote).toBe(false);
  });
});

describe('resolving is the purchaser\'s job and changes nothing else', () => {
  /** One open flag on the nails, with 49 of 50 received. */
  async function flagged() {
    db.pos = [po()];
    const { recordReceiving } = await load();
    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        {
          poItemId: 'pi-2',
          receivedQty: 49,
          discrepancy: { type: 'Damaged Item', remarks: '1 box crushed.' },
        },
      ],
    });
    return db.discrepancies[0];
  }

  it('Q — a purchaser resolves it and the resolution is recorded', async () => {
    const flag = await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();

    await resolveDiscrepancy({
      id: flag.id,
      poNumber: 'PO-001',
      resolution: 'Supplier will deliver the replacement box on Thursday.',
    });

    expect(db.discrepancies[0]).toMatchObject({
      status: 'resolved',
      resolvedBy: 'purchaser1',
      resolution: 'Supplier will deliver the replacement box on Thursday.',
    });
    expect(db.discrepancies[0].resolvedAt).toBeInstanceOf(Date);
    expect(auditFor('discrepancy_resolved')).toHaveLength(1);
    expect(auditFor('discrepancy_resolved')[0].detail).toContain('Supplier will deliver');
  });

  it('L — keeps the original report in history after resolving', async () => {
    const flag = await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy, getPODiscrepancies } = await load();

    await resolveDiscrepancy({ id: flag.id, poNumber: 'PO-001', resolution: 'Replacement inbound.' });

    const rows = await getPODiscrepancies('PO-001');
    expect(rows).toHaveLength(1);
    // Everything the checker filed is still on the row.
    expect(rows[0]).toMatchObject({
      discrepancyType: 'Damaged Item',
      remarks: '1 box crushed.',
      reportedBy: 'wh1',
      status: 'resolved',
      statusLabel: 'Resolved',
      resolvedBy: 'purchaser1',
      resolution: 'Replacement inbound.',
    });
  });

  it('M — rewrites neither the purchase nor the receiving quantity', async () => {
    await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();
    let itemWrites = 0;
    db.writes.itemUpdate = () => {
      itemWrites += 1;
    };

    await resolveDiscrepancy({
      id: db.discrepancies[0].id,
      poNumber: 'PO-001',
      resolution: 'False alarm, counted twice.',
    });

    // 50 bought, 49 accepted — and that stays true afterwards.
    expect(item('PO-001', 'pi-2').purchasedQty).toBe(50);
    expect(item('PO-001', 'pi-2').receivedQty).toBe(49);
    expect(itemWrites).toBe(0);
  });

  it('N — does not stamp a discrepancy lifecycle onto the purchase order', async () => {
    await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();
    let poWrites = 0;
    db.writes.poUpdate = () => {
      poWrites += 1;
    };

    await resolveDiscrepancy({ id: db.discrepancies[0].id, poNumber: 'PO-001', resolution: 'Closed.' });

    // The PO's own status is untouched: it still says what it always said, and
    // its section is derived from its quantities rather than from the flag.
    expect(poWrites).toBe(0);
    expect(db.pos[0].status).toBe('in_progress');
    expect(db.pos[0].statusLabel).toBe('In Progress');
  });

  it('O — leaves a PO with a unit still outstanding In Progress', async () => {
    await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy, getPOTracker } = await load();

    await resolveDiscrepancy({
      id: db.discrepancies[0].id,
      poNumber: 'PO-001',
      resolution: 'Supplier confirmed the last box ships Thursday.',
    });

    const t = await getPOTracker('PO-001');
    expect(t.items.find((i: any) => i.poItemId === 'pi-2').receivingOutstanding).toBe(1);
    expect(t.canComplete).toBe(false);
    expect(t.receivingDue).toBe(true);
    expect(t.statusLabel).toBe('In Progress');
  });

  it('R — a warehouse user cannot resolve, not even their own report', async () => {
    const flag = await flagged();
    const { resolveDiscrepancy } = await load();
    // Still acting as the warehouse checker who filed it.
    let wrote = false;
    db.writes.discrepancyUpdate = () => {
      wrote = true;
    };

    await expect(
      resolveDiscrepancy({ id: flag.id, poNumber: 'PO-001', resolution: 'Never mind.' }),
    ).rejects.toThrow(/Unauthorized|only admin/i);

    expect(wrote).toBe(false);
    expect(db.discrepancies[0].status).toBe('open');
  });

  it('refuses to resolve something already resolved', async () => {
    const flag = await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();
    await resolveDiscrepancy({ id: flag.id, poNumber: 'PO-001', resolution: 'First pass.' });

    await expect(
      resolveDiscrepancy({ id: flag.id, poNumber: 'PO-001', resolution: 'Second pass.' }),
    ).rejects.toThrow(/already been resolved/);
  });

  it('requires a resolution note', async () => {
    const flag = await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();

    await expect(
      resolveDiscrepancy({ id: flag.id, poNumber: 'PO-001', resolution: '   ' }),
    ).rejects.toThrow(/Record what the investigation found/);
  });

  it('refuses an id belonging to another purchase order', async () => {
    const flag = await flagged();
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();

    await expect(
      resolveDiscrepancy({ id: flag.id, poNumber: 'PO-OTHER', resolution: 'Not mine.' }),
    ).rejects.toThrow(/does not belong to this purchase order/);
  });
});

describe('reading the flags back', () => {
  it('the tracker shows the open flag and clears it once resolved', async () => {
    db.pos = [po()];
    const { recordReceiving, getPOTracker } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [
        { poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } },
      ],
    });

    const before = await getPOTracker('PO-001');
    expect(before.discrepancies).toHaveLength(1);
    expect(before.discrepancies[0].discrepancyType).toBe('Damaged Item');
    expect(before.discrepancies[0].statusLabel).toBe('Open');

    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();
    await resolveDiscrepancy({
      id: db.discrepancies[0].id,
      poNumber: 'PO-001',
      resolution: 'Replacement delivered separately.',
    });

    const after = await getPOTracker('PO-001');
    expect(after.discrepancies).toHaveLength(0);
  });

  it('is scoped to the PO, and open plus resolved alike', async () => {
    db.pos = [po(), po({
      poNumber: 'PO-002',
      createdAt: new Date('2026-10-02T08:00:00Z'),
      items: [{ id: 'pi-9', itemDescription: 'Sand', unit: 'm3', qty: 10, purchasedQty: 10, receivedQty: 10 }],
    })];
    const { recordReceiving, getPODiscrepancies } = await load();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-2', receivedQty: 49, discrepancy: { type: 'Damaged Item' } }],
    });
    actor.current = { id: 'a1', username: 'purchaser1', role: 'Admin', warehouse: null };
    const { resolveDiscrepancy } = await load();
    await resolveDiscrepancy({ id: db.discrepancies[0].id, poNumber: 'PO-001', resolution: 'Closed.' });

    // The resolved one is still there — that is the history — and the other PO
    // is untouched.
    const rows = await getPODiscrepancies('PO-001');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('resolved');
    expect(await getPODiscrepancies('PO-002')).toHaveLength(0);
  });

  it('keeps another warehouse out', async () => {
    db.pos = [po({ warehouse: 'OTHER' })];
    const { getPODiscrepancies } = await load();
    await expect(getPODiscrepancies('PO-001')).rejects.toThrow(/Unauthorized/);
  });
});
