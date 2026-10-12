// Shared testing infrastructure for the server-action suites.
//
// The repository already had no shared helper: every action test declared its own
// `vi.hoisted()` fixture, its own write spies and its own `where` interpreter
// inline. That worked, but the authorization suites added for the Phase 1
// security audit need the same three things in six files, and duplicating a
// `where` interpreter six times risks them drifting apart — a double that ignores
// `where` reports every row for every warehouse and silently passes a broken
// scope, which is precisely the bug class this suite exists to catch.
//
// Nothing here touches production behaviour: this module is only imported by
// test files, and it is imported *inside* the `vi.mock('@/lib/prisma')` factory
// so the double replaces the real client.

/** The role values the actions actually accept, as code defines them. */
export const ROLES = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  warehouse: 'Warehouse',
} as const;

/** Unauthenticated. `getCurrentUser()` returns null and every guard must fail. */
export const NO_SESSION = null;

export interface ActingUser {
  id: string;
  username: string;
  name: string;
  role: string;
  warehouse: string | null;
}

/**
 * A mutable acting identity. Tests assign `actor.current` to switch role or
 * warehouse mid-file, which is how one suite covers the role matrix without
 * re-mocking the auth module per test.
 */
export function createActor(over: Partial<ActingUser> = {}) {
  const state: { current: ActingUser | null } = {
    current: {
      id: 'u-admin',
      username: 'purchaser1',
      name: 'Purchaser One',
      role: ROLES.admin,
      warehouse: null as string | null,
      ...over,
    },
  }
  return state
}

/**
 * Records every write the code under test attempts, so a test can assert that a
 * refused or unauthorized operation never reached the database rather than merely
 * not throwing.
 */
export function createWriteSpy() {
  const calls: string[] = []
  return {
    calls,
    /** Every attempted write, as `Model.verb`. */
    callsTo: () => [...calls],
    /** Attempted writes against one model. */
    writesTo: (model: string) => calls.filter((c) => c.startsWith(`${model}.`)),
    /** Builds the hook a double's write method calls. */
    hook(model: string, verb: string) {
      return () => {
        calls.push(`${model}.${verb}`)
      }
    },
    reset() {
      calls.length = 0
    },
  }
}

export type WriteSpy = ReturnType<typeof createWriteSpy>

/**
 * Interpreter for the scalar `where` clauses the audited actions actually build.
 * Deliberately narrow: it supports exactly the shapes these actions construct, so
 * an unsupported clause surfaces as a failing test rather than as a filter that
 * silently matches everything.
 *
 * Relation filters (`items: { some: … }`) are handled separately by
 * `matchesRelationSome`, because `some` means "any nested line", which a flat
 * row comparison cannot express.
 */
export function matchesWhere(row: any, where: any): boolean {
  if (!where) return true

  // Equality on a scalar field.
  for (const key of SCALAR_KEYS) {
    // An ABSENT key is no filter. A key present with an explicit null is Prisma's
    // IS NULL, and the two must not be conflated: the archive scopes its audit-log
    // snapshot to `deliveryId: null` to exclude the retired DEL-* events, and an
    // interpreter that skipped the null would return every audit row instead.
    if (!Object.prototype.hasOwnProperty.call(where, key)) continue
    const cond = where[key]
    if (cond === undefined) continue
    if (cond === null) {
      if (row[key] !== null && row[key] !== undefined) return false
      continue
    }
    if (typeof cond === 'string') {
      if (row[key] !== cond) return false
      continue
    }
    if (typeof cond !== 'object') continue
    if (Array.isArray(cond.in) && !cond.in.includes(row[key])) return false
    if (Array.isArray(cond.notIn) && cond.notIn.includes(row[key])) return false
    if (cond.not !== undefined && row[key] === cond.not) return false
    if (cond.startsWith !== undefined && !String(row[key] ?? '').startsWith(cond.startsWith)) return false
    if (cond.contains !== undefined && !String(row[key] ?? '').toLowerCase().includes(cond.contains.toLowerCase())) return false
  }

  if (Array.isArray(where.OR) && !where.OR.some((arm: any) => matchesWhere(row, arm))) return false

  return true
}

const SCALAR_KEYS = [
  'warehouse',
  'poNumber',
  'mrsNo',
  'reqNumber',
  'sourceReqNumber',
  // The follow-up duplicate guard queries these directly.
  'followUpOfReqNumber',
  'followUpOfPoNumber',
  'username',
  'name',
  'status',
  'poType',
  'action',
  'reason',
  'id',
  // Distinguishes a live workflow audit event (no delivery) from a retired
  // DEL-* one, which the archive snapshot deliberately leaves out.
  'deliveryId',
  'itemId',
] as const

  /** `items: { some: { … } }` — true when ANY nested line matches the arm. */
  export function matchesRelationSome(row: any, arm: any): boolean {
    const lines: any[] = row.items ?? []
    return lines.some((line) => {
      if (arm.itemDescription?.contains !== undefined) {
        return String(line.itemDescription ?? '')
          .toLowerCase()
          .includes(arm.itemDescription.contains.toLowerCase())
      }
      if (arm.itemDescription?.in !== undefined) return arm.itemDescription.in.includes(line.itemDescription)
      if (arm.itemDescription !== undefined) return line.itemDescription === arm.itemDescription
      return true
    })
  }

/**
 * Applies a `where` clause that may mix scalar filters with a relation `some`.
 */
export function matchesFullWhere(row: any, where: any): boolean {
  if (!where) return true
  const scalar = { ...where }
  delete scalar.items
  if (where.items?.some && !matchesRelationSome(row, where.items.some)) return false
  return matchesWhere(row, scalar)
}