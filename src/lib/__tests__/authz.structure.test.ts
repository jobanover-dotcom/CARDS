import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// SECURITY AUDIT — architectural / structural authorization checks.
//
// These are SOURCE-level assertions, following the pattern already established in
// navigation.test.ts, tableLanguage.test.ts and procurement.test.ts. They exist
// because three of the Phase 1 findings are architectural: no middleware means the
// route tree enforces nothing, so a single missing per-action guard is anonymously
// reachable — which is exactly how warehouses.ts shipped.

const ROOT = path.resolve(__dirname, '../../..');
const ACTIONS_DIR = path.join(ROOT, 'actions');

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'));
}

/** Reads a file from the `actions/` directory. */
function read(file: string): string {
  return readFileSync(path.join(ACTIONS_DIR, file), 'utf8');
}

/** Reads a file relative to the repository root. */
function readRepo(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

/** Strips comments so a guard quoted in prose cannot be mistaken for enforcement. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The source of one exported function, from its declaration to the next
 * top-level `export`. Scoping matters: asserting on a slice that runs to the end
 * of the file makes a test pass or fail on a neighbour's code.
 */
function bodyOf(source: string, declaration: string): string {
  const stripped = code(source);
  // Match the whole declaration, not a prefix: 'updatePO' is also the start of
  // 'updatePOMonitoring', and a prefix match would silently scope the assertion
  // to the wrong function.
  const needle = `${declaration}(`;
  const start = stripped.indexOf(needle);
  if (start === -1) throw new Error(`Declaration not found: ${declaration}`);
  const next = stripped.indexOf('\nexport ', start + needle.length);
  return stripped.slice(start, next === -1 ? undefined : next);
}

describe('there is no route-level authentication middleware', () => {
  it('CONFIRMED: no middleware file exists anywhere in the repository', () => {
    const found: string[] = [];
    for (const dir of [ROOT, path.join(ROOT, 'src')]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (/^middleware\.(ts|js|tsx|jsx)$/.test(entry.name)) found.push(entry.name);
      }
    }
    expect(found).toEqual([]);
  });

  it('CONFIRMED: the dashboard layout guard is a CLIENT component using a client-side redirect', () => {
    const layout = readFileSync(path.join(ROOT, 'app/(dashboard)/layout.js'), 'utf8');
    // A client component cannot block a request: it runs after the response.
    expect(layout).toMatch(/^\s*'use client'/);
    expect(layout).toMatch(/router\.replace\(['"]\/login['"]\)/);
  });

  it('the role layouts perform no role check — a Warehouse user can render /admin', () => {
    for (const layout of ['admin/layout.js', 'warehouse/layout.js']) {
      const source = readFileSync(path.join(ROOT, 'app/(dashboard)', layout), 'utf8');
      expect(source).not.toMatch(/role\s*===|role\s*!==/);
    }
  });
});

describe('every action module is a server action', () => {
  it.each(actionFiles())('%s carries the "use server" directive', (file) => {
    expect(read(file).trimStart().startsWith("'use server'")).toBe(true);
  });

  /**
   * A "use server" module may only export async function declarations.
   *
   * Next.js validates this when the module is built, and `tsc --noEmit` does NOT:
   * `export { fn } from './lib'` is legal TypeScript whether or not `fn` is async,
   * so a re-export of an async helper sails through typecheck and the whole test
   * suite, then breaks `next build` with
   * "Only async functions are allowed to be exported in a 'use server' file."
   *
   * That is exactly how `actions/procurement.ts` shipped a re-export of
   * `reconcileMRSCompletion`. Nothing imported it from there — every consumer
   * already imported the module directly — so the binding was pure dead weight
   * that only a build could catch. Shared helpers belong in src/lib/ and are
   * imported from there; see deliveryQuantities.ts for the rule in prose.
   */
  it.each(actionFiles())('%s exports only async functions and types', (file) => {
    const offenders = code(read(file))
      .split('\n')
      .map((l) => l.trim())
      // `export async function`, and type/interface exports, which are erased at
      // compile time and carry no runtime binding.
      .filter((l) => !/^export\s+(async\s+function|type|interface)\b/.test(l))
      // An exported async arrow is an async function too.
      .filter((l) => !/^export\s+(const|let|var)\s+\w+\s*(:[^=]*?)?=\s*async\b/.test(l))
      // Anything left is a non-async value export: a re-export (`export {} from`),
      // a non-async function or const, `export *`, or a bare default.
      .filter((l) => /^export\b/.test(l));

    expect(offenders, `${file} exports a non-async binding`).toEqual([]);
  });
});

describe('privileged actions carry an authorization guard', () => {
  /**
   * Actions that MUST reject a caller before touching the database, and the
   * guard that does it. This table is derived from the Phase 1 findings: each
   * entry was verified by executing the action against a mocked data layer.
   */
  const REQUIRED: Array<{ file: string; fn: string; expect: RegExp }> = [
    { file: 'pos.ts', fn: 'createPO', expect: /role !== 'Admin' && user\.role !== 'Superadmin'/ },
    { file: 'pos.ts', fn: 'createPOWithApproval', expect: /assertCanManagePOs/ },
    { file: 'pos.ts', fn: 'createPOFromApprovedRequest', expect: /assertCanManagePOs/ },
    { file: 'pos.ts', fn: 'deletePO', expect: /role !== 'Superadmin'/ },
    { file: 'procurement.ts', fn: 'savePurchase', expect: /assertCanManagePOs/ },
    { file: 'procurement.ts', fn: 'createFollowUpPO', expect: /assertCanManagePOs/ },
    { file: 'procurement.ts', fn: 'resolveDiscrepancy', expect: /assertCanManagePOs/ },
    { file: 'requests.ts', fn: 'approveRemaining', expect: /assertElevatedActor/ },
    { file: 'requests.ts', fn: 'rejectRemaining', expect: /assertElevatedActor/ },
    { file: 'requests.ts', fn: 'deleteRequest', expect: /role !== 'Superadmin'/ },
    { file: 'users.ts', fn: 'addUser', expect: /assertElevated/ },
    { file: 'users.ts', fn: 'deleteUser', expect: /assertElevated/ },
    { file: 'users.ts', fn: 'updateUserWarehouse', expect: /assertElevated/ },
    { file: 'archive.ts', fn: 'systemReset', expect: /role !== 'Superadmin'/ },
    { file: 'archive.ts', fn: 'deleteArchiveEntry', expect: /role !== 'Superadmin'/ },
    { file: 'poReceipts.ts', fn: 'getPurchaseOrderReceiptUploadUrl', expect: /role !== 'Warehouse'/ },
  ];

  it.each(REQUIRED)('$file#$fn is guarded', ({ file, expect: pattern }) => {
    expect(code(read(file))).toMatch(pattern);
  });
});

describe('warehouses.ts guards both actions', () => {
  it('imports getCurrentUser and defines an allow-list guard', () => {
    const source = code(read('warehouses.ts'));
    expect(source).toMatch(/getCurrentUser/);
    expect(source).toMatch(/role !== 'Admin' && user\.role !== 'Superadmin'/);
  });

  it('addWarehouse authorizes before the write', () => {
    const fn = bodyOf(read('warehouses.ts'), 'export async function addWarehouse');
    const guard = fn.indexOf('assertCanManageWarehouses()');
    const write = fn.indexOf('prisma.warehouse.create');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });

  it('getWarehouses requires a session but no role', () => {
    const fn = bodyOf(read('warehouses.ts'), 'export async function getWarehouses');
    expect(fn).toMatch(/if \(!user\) throw new Error\('Unauthorized'\)/);
    expect(fn).not.toMatch(/role !==|role ===/);
  });
});

describe('auth.ts identity checks', () => {
  it('getProfileByUsername requires a session and matches caller to target', () => {
    const fn = bodyOf(read('auth.ts'), 'export async function getProfileByUsername');
    expect(fn).toMatch(/getCurrentUser\(\)/);
    expect(fn).toMatch(/if \(!caller\) throw new Error\('Unauthorized'\)/);
    expect(fn).toMatch(/caller\.username !== username/);
  });

  it('changePassword requires a session and refuses a foreign account', () => {
    const fn = bodyOf(read('auth.ts'), 'export async function changePassword');
    expect(fn).toMatch(/getCurrentUser\(\)/);
    expect(fn).toMatch(/caller\.username !== username/);
    // The current-password proof is preserved.
    expect(fn).toMatch(/signInWithPassword/);
  });
});

describe('archive.ts uses an allow-list for destructive operations', () => {
  it('assertElevated is still a deny-list for the read/restore actions', () => {
    const source = code(read('archive.ts'));
    const guard = source.slice(source.indexOf('async function assertElevated'), source.indexOf('type LogInput'));
    expect(guard).toMatch(/user\.role === 'Warehouse'/);
  });

  it('deleteWarehouseWithArchive uses a dedicated Superadmin allow-list', () => {
    const source = code(read('archive.ts'));
    expect(source).toMatch(/async function assertSuperadmin\(\)/);
    const fn = bodyOf(read('archive.ts'), 'export async function deleteWarehouseWithArchive');
    expect(fn).toMatch(/assertSuperadmin\(\)/);
    expect(fn).not.toMatch(/assertElevated\(\)/);
    // …before any Supabase login deletion or transaction.
    const guard = fn.indexOf('assertSuperadmin()');
    expect(guard).toBeLessThan(fn.indexOf('auth.admin.deleteUser'));
    expect(guard).toBeLessThan(fn.indexOf('runTx'));
  });
});

describe('updatePO resolves ownership before either write path', () => {
  it('the ownership check precedes the touchesWorkflow branch and both writes', () => {
    const fn = bodyOf(read('pos.ts'), 'export async function updatePO');
    const check = fn.search(/user\.role === 'Warehouse' && existing\.warehouse !== user\.warehouse/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fn.indexOf('if (touchesWorkflow)'));
    expect(check).toBeLessThan(fn.indexOf('tx.purchaseOrderItem.deleteMany'));
    expect(check).toBeLessThan(fn.indexOf('return prisma.purchaseOrder.update'));
  });

  it('performs exactly one AUTHORIZATION read, before the branch', () => {
    const fn = bodyOf(read('pos.ts'), 'export async function updatePO');
    const check = fn.indexOf('existing.warehouse !== user.warehouse');
    // One read before the ownership decision; the only later read is the
    // post-write re-read in the item-replacement branch.
    const before = fn.slice(0, check).match(/purchaseOrder\.findUnique/g) ?? [];
    const after = fn.slice(check).match(/purchaseOrder\.findUnique/g) ?? [];
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
  });
});

describe('approval reads are warehouse-scoped', () => {
  it('getRequestApprovalState resolves visibility before building its response', () => {
    const fn = bodyOf(read('requests.ts'), 'export async function getRequestApprovalState');
    expect(fn).toMatch(/assertRequestVisibleTo\(user, request\)/);
    expect(fn.indexOf('assertRequestVisibleTo(user, request)')).toBeLessThan(fn.indexOf('const lines ='));
  });

  it('getRequestApprovalLog checks the owning request before reading the log', () => {
    const fn = bodyOf(read('requests.ts'), 'export async function getRequestApprovalLog');
    const check = fn.indexOf('assertRequestVisibleTo(user, request)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fn.indexOf('requestApprovalLog.findMany'));
  });

  it('the shared visibility helper denies every non-owning warehouse, including null', () => {
    const fn = bodyOf(read('requests.ts'), 'function assertRequestVisibleTo');
    expect(fn).toMatch(/user\.role !== 'Warehouse'/);
    // Fails closed: a null request warehouse matches no user.
    expect(fn).toMatch(/if \(request\.warehouse && request\.warehouse === user\.warehouse\) return;/);
  });
});

describe('procurement.ts receiving ownership fails closed', () => {
  it('assertWarehouseOwns rejects a null PO warehouse explicitly', () => {
    const fn = bodyOf(read('procurement.ts'), 'async function assertWarehouseOwns');
    expect(fn).toMatch(/if \(!poWarehouse\)/);
    expect(fn).not.toMatch(/if \(poWarehouse &&/);
  });
});

describe('users.ts role integrity', () => {
  it('addUser validates against the canonical roles before creating a login', () => {
    const source = code(read('users.ts'));
    expect(source).toMatch(/profileCreateSchema\.parse\(/);
    const fn = bodyOf(read('users.ts'), 'export async function addUser');
    const parse = fn.indexOf('profileCreateSchema.parse');
    expect(parse).toBeGreaterThan(-1);
    expect(parse).toBeLessThan(fn.indexOf('createAdminSupabase'));
    expect(fn).toMatch(/assertSuperadminTarget\(caller\.role, parsed\.role, 'create'\)/);
  });

  it('deleteUser blocks a non-Superadmin from deleting a Superadmin, before the auth call', () => {
    const fn = bodyOf(read('users.ts'), 'export async function deleteUser');
    expect(fn).toMatch(/assertSuperadminTarget\(caller\.role, profile\.role, 'delete'\)/);
    expect(fn.indexOf('assertSuperadminTarget')).toBeLessThan(fn.indexOf('auth.admin.deleteUser'));
  });
});

describe('canonical role vocabulary', () => {
  it('PROFILE_ROLES matches the roles the guards actually compare', () => {
    const source = readRepo('src/lib/validations/request.ts');
    expect(source).toMatch(/PROFILE_ROLES = \['Superadmin', 'Admin', 'Warehouse'\]/);
    // 'Purchaser' is a display label only and must not be a stored role.
    const roleList = source.slice(source.indexOf('PROFILE_ROLES ='), source.indexOf('as const'));
    expect(roleList).not.toMatch(/'Purchaser'/);
  });

  it('profileSchema and profileCreateSchema agree on the role set', () => {
    const source = readRepo('src/lib/validations/request.ts');
    expect(source).toMatch(/role: z\.enum\(PROFILE_ROLES\)\.default\('Warehouse'\)/);
    expect(source).toMatch(/export const profileCreateSchema = profileSchema\.extend\(\{[\s\S]*?role: z\.enum\(PROFILE_ROLES\),[\s\S]*?\}\)/);
  });
});

describe('role vocabulary is still duplicated string literals across actions', () => {
  it('the same elevated-role test appears many times, with no shared constant', () => {
    let occurrences = 0;
    for (const file of actionFiles()) {
      const matches = code(read(file)).match(/role !== 'Admin' && user\.role !== 'Superadmin'|user\.role !== 'Admin' && user\.role !== 'Superadmin'/g);
      occurrences += matches?.length ?? 0;
    }
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });

  it('no ROLE constant is exported anywhere', () => {
    const libFiles = existsSync(path.join(ROOT, 'src/lib'))
      ? readdirSync(path.join(ROOT, 'src/lib'), { withFileTypes: true })
          .filter((e) => e.isFile() && /\.ts$/.test(e.name))
          .map((e) => readFileSync(path.join(ROOT, 'src/lib', e.name), 'utf8'))
      : [];
    expect(libFiles.join('\n')).not.toMatch(/export const ROLES|export const ROLE\b/);
  });
});

describe('state: every security suite in this phase is discoverable by the runner', () => {
  it('the new suites are named *.test.ts so vitest.config include picks them up', () => {
    const testsDir = path.join(ROOT, 'src/lib/__tests__');
    const securitySuites = readdirSync(testsDir).filter((f) => f.endsWith('.security.test.ts'));
    expect(securitySuites.sort()).toEqual([
      'archive.security.test.ts',
      'auth.security.test.ts',
      'pos.security.test.ts',
      'procurement.security.test.ts',
      'requests.security.test.ts',
      'users.security.test.ts',
      'warehouses.security.test.ts',
    ]);
  });
});
