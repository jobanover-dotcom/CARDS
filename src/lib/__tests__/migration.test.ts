import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'
import { mapLegacyPOToV1, isV1WorkflowPO } from '../poMigration'
import { remainingToDeliver, remainingToReceive } from '../deliveryQuantities'

function legacyPO(overrides = {}) {
  return {
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Open',
    monDeliveredBy: null,
    monDateDelivered: null,
    monReferenceNo: null,
    monQtyRvd: null,
    items: [{ id: 'i1', monitoringItems: [{ qtyReceived: 0 }] }],
    ...overrides,
  }
}

describe('legacy backfill mapping', () => {
  it('moves untouched POs to awaiting_purchase', () => {
    expect(mapLegacyPOToV1(legacyPO())).toEqual({
      status: 'awaiting_purchase',
      statusLabel: 'Awaiting Purchase',
    })
  })

  it('leaves completed POs alone', () => {
    expect(mapLegacyPOToV1(legacyPO({ status: 'completed', statusLabel: 'Completed' }))).toBeNull()
  })

  it('leaves POs with receiving activity alone', () => {
    expect(
      mapLegacyPOToV1(legacyPO({ items: [{ id: 'i1', monitoringItems: [{ qtyReceived: 5 }] }] })),
    ).toBeNull()
    expect(mapLegacyPOToV1(legacyPO({ monDeliveredBy: 'Juan' }))).toBeNull()
  })

  it('never assigns purchasedQty during backfill', () => {
    const mapped = mapLegacyPOToV1(legacyPO())
    expect(mapped).not.toHaveProperty('purchasedQty')
  })
})

describe('V1 workflow ownership guard', () => {
  it('flags the canonical procurement lifecycle states', () => {
    expect(isV1WorkflowPO(legacyPO({ status: 'awaiting_purchase' }))).toBe(true)
    expect(isV1WorkflowPO(legacyPO({ status: 'in_progress' }))).toBe(true)
    expect(isV1WorkflowPO(legacyPO({ status: 'completed' }))).toBe(true)
  })

  it('no longer owns the retired delivery gates', () => {
    // These are remapped to in_progress by the migration and are read-only
    // compatibility values; the guard must not key off them any more.
    expect(isV1WorkflowPO(legacyPO({ status: 'purchase_confirmed' }))).toBe(false)
    expect(isV1WorkflowPO(legacyPO({ status: 'ready_for_delivery' }))).toBe(false)
  })

  it('flags confirmed purchases and existing deliveries', () => {
    expect(
      isV1WorkflowPO(legacyPO({ items: [{ id: 'i1', purchasedQty: 10, monitoringItems: [] }] })),
    ).toBe(true)
    expect(isV1WorkflowPO({ ...legacyPO(), _count: { deliveries: 1 } })).toBe(true)
  })

  it('leaves an untouched legacy PO outside the guard', () => {
    expect(isV1WorkflowPO(legacyPO())).toBe(false)
    expect(isV1WorkflowPO(null)).toBe(false)
  })

  it('owns a completed PO so the legacy path cannot rewrite it', () => {
    // A completed PO is terminal for the procurement workflow; the deprecated
    // single-shot receiving path must refuse it.
    expect(isV1WorkflowPO(legacyPO({ status: 'completed', statusLabel: 'Completed' }))).toBe(true)
  })
})

describe('V1 end-to-end quantity scenario', () => {
  // Request 100 → approved 100 → purchased 100 → D1: 60 → received 58
  // → D2: 40 → received 40 ⇒ purchased 100, delivered 100, received 98, discrepancy 2
  it('tracks the full chain without overwriting stages', () => {
    const purchasedQty = 100
    const d1 = { deliveredQty: 60, receivedQty: 58 }
    expect(remainingToDeliver({ purchasedQty, deliveries: [] })).toBe(100)
    expect(remainingToDeliver({ purchasedQty, deliveries: [d1] })).toBe(40)

    const d2 = { deliveredQty: 40, receivedQty: 40 }
    const all = [d1, d2]
    const delivered = all.reduce((s, d) => s + d.deliveredQty, 0)
    const received = all.reduce((s, d) => s + d.receivedQty, 0)
    expect(delivered).toBe(100)
    expect(received).toBe(98)
    expect(delivered - received).toBe(2) // discrepancy
    expect(remainingToDeliver({ purchasedQty, deliveries: all })).toBe(0)
    expect(remainingToReceive(all)).toBe(2) // shortfall never received; covered by follow-up, not overwritten
  })
})

// ---------------------------------------------------------------------------
// Row-level invariants for PurchaseOrderItem.
//
// These constraints are the database's half of the
// Approved -> Purchased -> Received chain. The application has always checked
// them (assertValidPurchasedQty / assertValidReceivedQty), but a CHECK is what
// makes them true rather than merely intended.
//
// Two properties of the migration are load-bearing enough to pin in a test:
// it must add the constraints WITHOUT VALIDATING in the same statement, so a
// bad row fails loudly instead of blocking a deploy; and it must never touch a
// row, because clamping purchasedQty would erase the record of what was really
// bought.
// ---------------------------------------------------------------------------
describe('PurchaseOrderItem quantity constraints', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20261008034841_purchased_within_po_item/migration.sql'),
    'utf8',
  )

  it('bounds a purchase by the quantity its line was raised for', () => {
    expect(sql).toContain('PurchaseOrderItem_purchased_within_qty')
    expect(sql).toMatch(/"purchasedQty" >= 0 AND "purchasedQty" <= "qty"/)
    // NULL means "nothing purchased yet", which is a valid state.
    expect(sql).toContain('"purchasedQty" IS NULL OR')
  })

  it('forbids receiving more than was purchased', () => {
    expect(sql).toContain('PurchaseOrderItem_received_within_purchased')
    expect(sql).toMatch(/"receivedQty" <= COALESCE\("purchasedQty", 0\)/)
  })

  it('adds each constraint NOT VALID, then validates it separately', () => {
    const adds = sql.match(/ADD CONSTRAINT[\s\S]*?NOT VALID;/g) ?? []
    expect(adds).toHaveLength(2)
    // Every constraint added NOT VALID is subsequently validated.
    expect(sql).toContain('VALIDATE CONSTRAINT "PurchaseOrderItem_purchased_within_qty"')
    expect(sql).toContain('VALIDATE CONSTRAINT "PurchaseOrderItem_received_within_purchased"')
  })

  it('never rewrites a stored quantity', () => {
    // A repair here would quietly change what the system believes was bought.
    expect(sql).not.toMatch(/\bUPDATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\b/i)
    expect(sql).not.toMatch(/ALTER COLUMN/i)
    expect(sql).not.toMatch(/LEAST|GREATEST|TRUNC/i)
  })
})

// ---------------------------------------------------------------------------
// The item-level discrepancy table.
//
// Two properties are load-bearing enough to pin in a test. It must not be able to
// hold a quantity, because a discrepancy is an exception someone reported and
// APPROVED -> PURCHASED -> RECEIVED is the only quantity model — a `damagedQty`
// column here would be a second one. And a resolved row must be self-evidently
// resolved, so `status` can never be edited into a state that claims to be closed
// while recording nobody and nothing.
// ---------------------------------------------------------------------------
describe('the receiving discrepancy table', () => {
  const raw = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20261008040312_add_receiving_discrepancies/migration.sql'),
    'utf8',
  );
  // Assertions run against the executable SQL, not the prose. This migration
  // explains WHY it is the shape it is, and those explanations necessarily name
  // the statements it refuses to contain — so checking the raw text would fail on
  // its own documentation.
  const sql = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('creates one table, per item rather than per purchase order', () => {
    expect(sql).toContain('CREATE TABLE "ReceivingDiscrepancy"');
    expect(sql).toMatch(/"poItemId" TEXT NOT NULL/);
    expect(sql).toMatch(/"poNumber" TEXT NOT NULL/);
    // A PO-item id with no foreign key, matching ReceivingRecord's deliberate
    // choice: updatePO() replaces a PO's item rows wholesale.
    expect(sql).not.toMatch(/ReceivingDiscrepancy_poItemId_fkey/);
  })

  it('carries no quantity column', () => {
    // If a damaged/wrong-item/rejected column ever appears, a parallel quantity
    // system has crept in and the approved/purchased/received chain is no longer
    // the only source of truth.
    for (const forbidden of [
      'damagedQty',
      'wrongItemQty',
      'rejectedReceivedQty',
      'acceptedQty',
      'qty',
      'quantity',
    ]) {
      expect(sql, `${forbidden} does not belong on this table`).not.toMatch(
        new RegExp(`"${forbidden}"`),
      );
    }
    expect(sql).toMatch(/"discrepancyType" TEXT NOT NULL/);
    expect(sql).toMatch(/"remarks" TEXT/);
  })

  it('keeps the report and its resolution', () => {
    expect(sql).toMatch(/"reportedBy" TEXT NOT NULL/);
    expect(sql).toMatch(/"reportedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/"resolvedBy" TEXT/);
    expect(sql).toMatch(/"resolvedAt" TIMESTAMP\(3\)/);
    expect(sql).toMatch(/"resolution" TEXT/);
  })

  it('allows exactly two states', () => {
    expect(sql).toContain('ReceivingDiscrepancy_status_known');
    expect(sql).toMatch(/CHECK \("status" IN \('open', 'resolved'\)\)/);
  });

  it('requires a type, and a complete resolution', () => {
    expect(sql).toContain('ReceivingDiscrepancy_type_present');
    expect(sql).toMatch(/btrim\("discrepancyType"\) <> ''/);
    expect(sql).toContain('ReceivingDiscrepancy_resolution_complete');
  });

  it('never rewrites or removes anything', () => {
    // Pure DDL. The table is new, so there was nothing to migrate into it, and a
    // statement here that touches rows would mean data had been invented.
    //
    // Matched at the START of a statement, not anywhere in the text:
    // `ON DELETE CASCADE ON UPDATE CASCADE` is a referential action on the
    // foreign key, not a DML statement, and a naive word search would flag it.
    const dml = /^\s*(UPDATE|DELETE|INSERT|TRUNCATE|COPY)\b/im;
    expect(sql).not.toMatch(dml);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it('is not seeded from the frozen archive flags', () => {
    // Historical POs stay flagged through poType and archived Delivery rows,
    // which the union in isDiscrepancyPO() still reads. Back-filling here would
    // duplicate that verdict as live records nobody filed.
    expect(sql).not.toMatch(/DeliveryAuditLog/);
    expect(sql).not.toMatch(/poType/);
  });
})
