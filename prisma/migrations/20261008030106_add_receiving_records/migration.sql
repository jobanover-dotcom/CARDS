-- Receiving history: structured per-line records for each arrival.
--
-- DeliveryAuditLog.detail stays the human-readable summary the PO history already
-- renders. This table is the machine-readable counterpart, because a correction
-- cannot be applied to prose: "Cement: 0 + 30 = 30 bags" has to be parsed back,
-- and a description containing a colon or a space breaks that.

CREATE TABLE "ReceivingRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "fromQty" INTEGER NOT NULL,
    "toQty" INTEGER NOT NULL,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "editedBy" TEXT,
    "previousToQty" INTEGER,

    CONSTRAINT "ReceivingRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivingRecord_poNumber_idx" ON "ReceivingRecord"("poNumber");
CREATE INDEX "ReceivingRecord_poNumber_createdAt_idx" ON "ReceivingRecord"("poNumber", "createdAt");

-- CASCADE, matching PurchaseOrderReceipt: deletePO() already clears audit rows by
-- hand, so this row type must not outlive the purchase order it belongs to.
ALTER TABLE "ReceivingRecord"
    ADD CONSTRAINT "ReceivingRecord_poNumber_fkey"
    FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- A cumulative total never moves backwards, and an edit may not drop below the
-- total that was already standing before the event being edited.
ALTER TABLE "ReceivingRecord"
    ADD CONSTRAINT "ReceivingRecord_quantities_sane"
    CHECK ("fromQty" >= 0 AND "toQty" >= "fromQty");

-- Backfill from the prose detail of any receiving event recorded before this
-- migration.
--
-- The pattern is exactly what describeLines() in actions/procurement.ts writes:
--   "<description>: <from> + <delta> = <to> <unit>"   joined by "; "
--
-- It is deliberately defensive rather than clever. A row whose detail does not
-- match is LEFT ALONE rather than guessed at: the history still renders it from
-- DeliveryAuditLog as read-only text, and editLatestReceiving() refuses to edit
-- an event with no ReceivingRecord rows. A wrong backfill would be silently
-- correctable into a wrong quantity, which is far worse than a read-only record.
-- One event id per audit row: a pre-migration event is by definition a single
-- save, so its whole detail string is one event.
--
-- regexp_matches (plural) returns EVERY match, so one audit row yields one
-- ReceivingRecord per line rather than only the first. It is aliased as a single
-- array column and subscripted, which is the form Postgres accepts here — the
-- multi-column alias form (AS m(a, b, c)) is rejected for this set-returning
-- function.
INSERT INTO "ReceivingRecord"
    ("id", "eventId", "poNumber", "poItemId", "itemDescription", "unit", "fromQty", "toQty", "actor", "createdAt")
SELECT
    -- Deterministic, so re-running the migration cannot duplicate a row.
    'recv-legacy-' || l.id || '-' || md5(m.tokens[1]),
    'legacy-' || l.id,
    l."poNumber",
    i.id,
    btrim(m.tokens[1]),
    btrim(m.tokens[5]),
    m.tokens[2]::int,
    m.tokens[4]::int,
    l."actor",
    l."createdAt"
FROM "DeliveryAuditLog" l
CROSS JOIN LATERAL regexp_matches(
    l.detail,
    '([^:;]+):\s*(-?\d+)\s*\+\s*(-?\d+)\s*=\s*(-?\d+)\s+([^;]*)',
    'g'
) AS m(tokens)
JOIN "PurchaseOrderItem" i
    ON i."poNumber" = l."poNumber"
   AND btrim(i."itemDescription") = btrim(m.tokens[1])
WHERE l.action = 'receiving_recorded'
  AND l."poNumber" IS NOT NULL
  AND l.detail IS NOT NULL
  -- A capture that did not parse, or a total that moves backwards, is skipped
  -- rather than stored: the history falls back to its read-only prose row.
  AND m.tokens[2] ~ '^-?\d+$'
  AND m.tokens[4] ~ '^-?\d+$'
  AND m.tokens[4]::int >= m.tokens[2]::int
ON CONFLICT DO NOTHING;