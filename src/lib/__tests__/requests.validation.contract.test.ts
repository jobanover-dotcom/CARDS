import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// PHASE 2 AUDIT — Part 3, structural layer.
//
// The behavioural quantity tests live in requests.validation.test.ts, which
// executes the action. This file pins the validation CONTRACT in the source and
// the schema, so a future refactor cannot quietly widen either without a test
// failing. It follows the source-scan pattern already established in
// navigation.test.ts / tableLanguage.test.ts / authz.structure.test.ts.

const ROOT = path.resolve(__dirname, '../../..');
const ACTIONS = path.join(ROOT, 'actions');
const MIGRATIONS = path.join(ROOT, 'prisma/migrations');

/** Strips comments so a rule quoted in prose is not mistaken for enforcement. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The source of one exported function, up to the next top-level `export`. */
function bodyOf(source: string, declaration: string): string {
  const stripped = code(source);
  const needle = `${declaration}(`;
  const start = stripped.indexOf(needle);
  if (start === -1) throw new Error(`Declaration not found: ${declaration}`);
  const next = stripped.indexOf('\nexport ', start + needle.length);
  return stripped.slice(start, next === -1 ? undefined : next);
}

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .map((dir) => {
      const file = path.join(MIGRATIONS, dir, 'migration.sql');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    })
    .join('\n');
}

const requests = readFileSync(path.join(ACTIONS, 'requests.ts'), 'utf8');
const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
const allSql = migrationSql();

describe('createRequest validation contract', () => {
  it('authenticates and authorizes before any write', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    const auth = fn.indexOf('getCurrentUser()');
    const gate = fn.indexOf('assertCanCreateRequest(user)');
    const write = fn.indexOf('warehouseRequest.create');
    expect(auth).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(write);
  });

  it('parses the boundary schema before any read or write', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    const parse = fn.indexOf('createRequestSchema.parse');
    expect(parse).toBeGreaterThan(-1);
    expect(parse).toBeLessThan(fn.indexOf('return runTx'));
  });

  it('DEFECT-FREE (P2-04/05): validation is Zod, not a hand-rolled item loop', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/createRequestSchema\.parse/);
    // The old single-purpose helper is gone.
    expect(requests).not.toMatch(/function validateRequestItems/);
  });

  it('the quantity ceiling is the PostgreSQL int4 maximum', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/validations/request.ts'), 'utf8');
    expect(source).toMatch(/MAX_REQUEST_QTY = 2_147_483_647/);
    // The bound lives on the ITEM schema that createRequestSchema builds from.
    const item = source.slice(
      source.indexOf('export const createRequestItemSchema'),
      source.indexOf('export const createRequestSchema'),
    );
    expect(item).toMatch(/\.max\(MAX_REQUEST_QTY/);
    expect(item).toMatch(/\.int\(/);
    expect(item).toMatch(/\.positive\(/);
  });

  it('every string field is trimmed and then required', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/validations/request.ts'), 'utf8');
    const helper = source.slice(source.indexOf('const requiredText'), source.indexOf('export const createRequestItemSchema'));
    expect(helper).toMatch(/\.trim\(\)/);
    expect(helper).toMatch(/\.min\(1,/);
    expect(helper).toMatch(/\.max\(/);
  });

  it('validates unit, which the old helper never read', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/validations/request.ts'), 'utf8');
    const item = source.slice(
      source.indexOf('export const createRequestItemSchema'),
      source.indexOf('export const createRequestSchema'),
    );
    expect(item).toMatch(/unit: requiredText\('Unit', 50\)/);
  });

  it('reqNumber is optional on input and never persisted from it', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/const reqNumber = await allocateReqNumber\(tx\)/);
    expect(fn).not.toMatch(/reqNumber: parsed\.reqNumber/);
  });

  it('DEFECT-FREE (P2-02): persists an explicit allow-list, not a payload spread', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    // No `...rest` / `...parsed` reaching the create.
    expect(fn).not.toMatch(/\.\.\.rest/);
    expect(fn).not.toMatch(/\.\.\.parsed[,}]/);
    expect(fn).toMatch(/data: \{/);
    // Every persisted column is named explicitly.
    for (const field of ['date', 'reqNumber', 'mrsNo', 'requestedBy', 'requisitioner', 'warehouse', 'status', 'remarks']) {
      expect(fn, `${field} is persisted explicitly`).toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it('server-owned fields are never taken from the payload', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/warehouse: user\.warehouse \?\? null/);
    expect(fn).toMatch(/status: REQUEST_STATUS\.PENDING\.value/);
    expect(fn).toMatch(/remarks: null/);
    expect(fn).not.toMatch(/warehouse: parsed\.warehouse/);
    expect(fn).not.toMatch(/status: parsed\.status/);
    expect(fn).not.toMatch(/remarks: parsed\.remarks/);
  });

  it('the nested item create maps only the three owned fields', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(
      /create: items\.map\(\(i\) => \(\{\s*itemDescription: i\.itemDescription\.trim\(\),\s*qty: i\.qty,\s*unit: i\.unit\.trim\(\),?\s*\}\)\)/,
    );
  });

  it('mutually excludes the two follow-up source fields', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/validations/request.ts'), 'utf8');
    const schema = source.slice(source.indexOf('export const createRequestSchema'));
    expect(schema).toMatch(/refine\(\(v\) => !\(v\.followUpOfReqNumber && v\.followUpOfPoNumber\)/);
    expect(schema).toMatch(/cannot reference both a request and a purchase order/);
  });

  it('follow-up quantities are AGGREGATED, not collapsed by a Map', () => {
    // A summing accumulator now lives in src/lib/mrsAggregates.ts, shared with
    // the PO path so the two entry points cannot disagree on the key or the sum.
    // The collapsing shape `new Map(items.map(i => [desc, qty]))` existed nowhere
    // in executable code. Comments are stripped first, so the doc comment that
    // explains the old behaviour is not mistaken for the thing itself.
    expect(code(requests)).not.toMatch(/new Map\(items\.map/);
    // The shared aggregator is used wherever quantities are summed by description.
    // There is now ONE such call site: the procurement follow-up branch. The
    // request-level branch that made it two was RETIRED (no role may file one)
    // and its creation logic deleted.
    expect((code(requests).match(/aggregateItemQuantities\(items\)/g) ?? []).length).toBe(1);

    const helper = readFileSync(path.join(ROOT, 'src/lib/mrsAggregates.ts'), 'utf8');
    const fn = helper.slice(
      helper.indexOf('export function aggregateItemQuantities'),
      helper.indexOf('export function aggregateItemQuantities') + 600,
    );
    expect(fn).toMatch(/totals\.set\(key, \(totals\.get\(key\) \?\? 0\) \+ item\.qty\)/);
    // It keys on the SAME normalizer the authoritative MRS read uses.
    expect(fn).toMatch(/normalizeItemDescription\(item\.itemDescription\)/);
  });

  it('no longer validates a request-level follow-up, because it cannot be filed', () => {
    // Request-level follow-up was retired. The parent-description check and the
    // outstanding-balance cap it used to run went with the creation logic, so
    // asserting them would pin dead code. What must hold instead is that the
    // field is refused before any of that maths runs.
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/followUpOfReqNumber/);
    expect(fn).toMatch(/no longer available/);
    expect(fn).not.toMatch(/parentKeys/);
    expect(fn).not.toMatch(/is not part of request/);
    // The retirement guard precedes any parent lookup, so a refused follow-up
    // cannot be used to probe whether a request exists.
    const guardAt = fn.indexOf('no longer available');
    const lookupAt = fn.indexOf('Source request');
    expect(lookupAt === -1 || guardAt < lookupAt).toBe(true);
  });

  it('derives a follow-up MRS from the authoritative source', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/mrsNo = source\.mrsNo/);
    // The payload value is only the default for a plain request.
    expect(fn).toMatch(/let mrsNo = parsed\.mrsNo/);
  });

  it('P2-01/P2-10: the creation gate is a role ALLOW-LIST, not a deny-list', () => {
    const fn = bodyOf(requests, 'function assertCanCreateRequest');
    expect(fn).toMatch(/user\.role !== 'Warehouse'/);
    expect(fn).toMatch(/only warehouse users can create material requests/);
    expect(fn).toMatch(/if \(!user\.warehouse\)/);
    // No deny-list shape.
    expect(fn).not.toMatch(/role === 'Warehouse'/);
  });

  it('P2-10: the PO compatibility branch keeps its own purchaser-only gate', () => {
    const fn = bodyOf(requests, 'export async function createRequest');
    expect(fn).toMatch(/user\.role !== 'Admin' && user\.role !== 'Superadmin'/);
    expect(fn).toMatch(/handled by the purchaser via Follow-up Purchase/);
  });
});

describe('WarehouseRequest schema constraints', () => {
  const requestModel = schema.slice(
    schema.indexOf('model WarehouseRequest {'),
    schema.indexOf('model WarehouseRequestItem {'),
  );
  const itemModel = schema.slice(
    schema.indexOf('model WarehouseRequestItem {'),
    schema.indexOf('model ReceivingRecord {'),
  );

  it('reqNumber is unique in the schema', () => {
    expect(requestModel).toMatch(/reqNumber String @unique/);
  });

  it('the migration that created it carries the unique index', () => {
    expect(allSql).toMatch(
      /CREATE UNIQUE INDEX "WarehouseRequest_reqNumber_key" ON "WarehouseRequest"\("reqNumber"\)/,
    );
  });

  it('qty is a 32-bit integer column, which is the real ceiling', () => {
    // Prisma `Int` maps to PostgreSQL integer (int4): -2147483648..2147483647.
    expect(itemModel).toMatch(/\n  qty Int\n/);
  });

  it('CONFIRMED: no CHECK constrains WarehouseRequestItem.qty itself', () => {
    // The only qty CHECKs in the database are on PurchaseOrderItem and
    // ReceivingRecord. WarehouseRequestItem.qty has a positive check only as far
    // as approvedQty/rejectedQty are bounded relative to it.
    expect(allSql).not.toMatch(/CHECK[^;]*"WarehouseRequestItem_qty_[^"]*"/);
  });

  it('WarehouseRequestItem does have a bound on approved+rejected against qty', () => {
    expect(allSql).toMatch(/WarehouseRequestItem_approval_within_qty/);
  });

  it('warehouse is plain TEXT with no foreign key to Warehouse', () => {
    expect(requestModel).toMatch(/warehouse String\?/);
    expect(requestModel).not.toMatch(/@relation\(fields: \[warehouse\]/);
  });

  it('mrsNo is plain TEXT — not unique, no foreign key, no index', () => {
    expect(requestModel).toMatch(/mrsNo String\n/);
    expect(requestModel).not.toMatch(/mrsNo String @unique/);
    expect(requestModel).not.toMatch(/@relation\(fields: \[mrsNo\]/);
  });

  it('followUpOfReqNumber and followUpOfPoNumber are plain TEXT with no foreign key', () => {
    expect(requestModel).toMatch(/followUpOfReqNumber String\?/);
    expect(requestModel).toMatch(/followUpOfPoNumber String\?/);
    expect(requestModel).not.toMatch(/@relation\(fields: \[followUp/);
  });

  it('PurchaseOrder.sourceReqNumber back to the request is plain TEXT with no foreign key', () => {
    const po = schema.slice(
      schema.indexOf('model PurchaseOrder {'),
      schema.indexOf('model PurchaseOrderItem {'),
    );
    expect(po).toMatch(/sourceReqNumber String\?/);
    expect(po).not.toMatch(/@relation\(fields: \[sourceReqNumber\]/);
  });

  it('CONFIRMED: no CHECK constrains WarehouseRequest.status', () => {
    expect(allSql).not.toMatch(/CHECK[^;]*"WarehouseRequest[^;]*status/i);
  });

  it('CONFIRMED: no trigger or rule enforces request invariants anywhere', () => {
    expect(allSql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(allSql).not.toMatch(/CREATE\s+RULE/i);
  });
});