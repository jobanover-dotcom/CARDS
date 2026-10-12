import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/users.ts
//
// FINDING under test: `addUser` writes `data.role` straight through. The role
// column is plain TEXT with no DB CHECK and no Zod, and `profileSchema` (whose
// enum lists 'Purchaser' and omits 'Admin') is never imported by any action.

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
  profiles: [] as any[],
  spy: null as any,
  authCreated: [] as any[],
  authDeleted: [] as string[],
  authIdCounter: 1,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy, matchesFullWhere } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const client = () => ({
    profile: {
      findMany: async (args: any) => state.profiles.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const w = args?.where ?? {};
        return state.profiles.find((p) => (w.username ? p.username === w.username : w.id ? p.id === w.id : false)) ?? null;
      },
      count: async (args: any) => state.profiles.filter((p) => matchesFullWhere(p, args?.where)).length,
      create: async (args: any) => {
        spy.hook('profile', 'create')(args);
        const row = { createdAt: new Date(), updatedAt: new Date(), ...args.data };
        state.profiles.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('profile', 'update')(args);
        const row = state.profiles.find((p) => p.username === args.where?.username);
        if (!row) return null;
        Object.assign(row, args.data);
        return row;
      },
      delete: async (args: any) => {
        spy.hook('profile', 'delete')(args);
        const idx = state.profiles.findIndex((p) => p.username === args.where?.username);
        return idx >= 0 ? state.profiles.splice(idx, 1)[0] : null;
      },
    },
  });

  return {
    prisma: {
      profile: {
        findMany: async (args: any) => state.profiles.filter((p) => !args?.where || Object.keys(args.where).length === 0 || args.where.name !== undefined),
        count: async () => state.profiles.length,
        findUnique: async (args: any) => client().profile.findUnique(args),
        create: client().profile.create,
        update: client().profile.update,
        delete: client().profile.delete,
      },
      // `getUsers` uses the array form of $transaction, not the callback form.
      $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
    },
    runTx: async (fn: any) => fn(client()),
  };
});

vi.mock('@/lib/supabase-server', () => ({
  createAdminSupabase: async () => ({
    auth: {
      admin: {
        createUser: async ({ email, password }: { email: string; password: string }) => {
          state.authCreated.push({ email, password });
          return { data: { user: { id: `auth-${state.authIdCounter++}` } }, error: null };
        },
        deleteUser: async (id: string) => {
          state.authDeleted.push(id);
          return { data: {}, error: null };
        },
      },
    },
  }),
  createServerSupabase: async () => ({ auth: {} }),
}));

const load = () => import('@/actions/users') as Promise<any>;

function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'u-admin', username: 'purchaser1', name: 'Purchaser One',
    role: ROLES.admin, warehouse: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

beforeEach(() => {
  state.profiles = [
    profile(),
    profile({ id: 'u-super', username: 'superadmin', role: ROLES.superadmin }),
    profile({ id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' }),
  ];
  state.spy?.reset();
  state.authCreated = [];
  state.authDeleted = [];
  state.authIdCounter = 1;
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('the elevated guard', () => {
  it('rejects an unauthenticated caller on every action, with no writes and no Supabase call', async () => {
    actor.current = NO_SESSION;
    const users = await load();

    await expect(users.getUsers()).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.addUser({ username: 'x1', name: 'X', role: ROLES.admin })).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.deleteUser('wh_bajada')).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.updateUserWarehouse('wh_bajada', 'North')).rejects.toThrow(/only purchasers and superadmins/i);

    expect(state.spy.callsTo()).toEqual([]);
    expect(state.authCreated).toEqual([]);
    expect(state.authDeleted).toEqual([]);
  });

  it('rejects a Warehouse role on every action, with no writes and no Supabase call', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const users = await load();

    await expect(users.getUsers()).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.addUser({ username: 'x1', name: 'X', role: ROLES.admin })).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.deleteUser('purchaser1')).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(users.updateUserWarehouse('purchaser1', 'North')).rejects.toThrow(/only purchasers and superadmins/i);

    expect(state.spy.callsTo()).toEqual([]);
    expect(state.authCreated).toEqual([]);
    expect(state.authDeleted).toEqual([]);
  });

  it('admits Admin and Superadmin', async () => {
    const users = await load();
    for (const [role, id] of [[ROLES.admin, 'u-admin'], [ROLES.superadmin, 'u-super']] as const) {
      actor.current = { id, username: id, role, warehouse: null };
      await expect(users.getUsers()).resolves.toBeTruthy();
    }
  });
});

describe('addUser — role is validated and privilege-bounded', () => {
  it('an Admin CANNOT mint a Superadmin — no privilege escalation', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    await expect(addUser({ username: 'backdoor', name: 'Back Door', role: ROLES.superadmin })).rejects.toThrow(
      /only the Superadmin can create a Superadmin/i,
    );

    expect(state.profiles.some((p) => p.username === 'backdoor')).toBe(false);
    expect(state.authCreated).toEqual([]);
    expect(state.spy.writesTo('profile')).toEqual([]);
  });

  it('a Superadmin CAN mint a Superadmin', async () => {
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { addUser } = await load();

    const created = await addUser({ username: 'second_super', name: 'Second', role: ROLES.superadmin });

    expect(created.role).toBe(ROLES.superadmin);
  });

  it('an Admin CAN create Admin and Warehouse accounts', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    await expect(addUser({ username: 'new_admin', name: 'A', role: ROLES.admin })).resolves.toMatchObject({ role: ROLES.admin });
    await expect(
      addUser({ username: 'new_wh', name: 'W', role: ROLES.warehouse, warehouse: 'Bajada' }),
    ).resolves.toMatchObject({ role: ROLES.warehouse, warehouse: 'Bajada' });
  });

  it('rejects the display-only role "Purchaser", which matches no authorization guard', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    await expect(addUser({ username: 'typo_user', name: 'Typo', role: 'Purchaser' })).rejects.toThrow();
    expect(state.profiles.some((p) => p.username === 'typo_user')).toBe(false);
    expect(state.authCreated).toEqual([]);
  });

  it('rejects an arbitrary SQL-ish role string', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    await expect(addUser({ username: 'junk', name: 'Junk', role: 'ROOT; DROP TABLE' })).rejects.toThrow();
    expect(state.profiles.some((p) => p.username === 'junk')).toBe(false);
  });

  it('rejects a non-string role without coercing it', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    for (const role of [42, null, undefined, { role: 'Admin' }, ['Admin']]) {
      await expect(addUser({ username: 'weird', name: 'Weird', role: role as any })).rejects.toThrow();
    }
    expect(state.profiles).toHaveLength(3);
  });

  it('rejects a case-variant role instead of normalising it', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();
    // 'admin' would not match any `role !== 'Admin'` guard, producing an account
    // with no effective permissions.
    await expect(addUser({ username: 'casey', name: 'Casey', role: 'admin' })).rejects.toThrow();
  });

  it('validates the username before creating a Supabase login', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    // profileSchema requires >= 3 characters, so an empty username never reaches
    // the auth service.
    await expect(addUser({ username: '', name: 'No Username', role: ROLES.warehouse })).rejects.toThrow();
    expect(state.authCreated).toEqual([]);
  });

  it('reports the role before the Supabase login exists', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { addUser } = await load();

    await expect(addUser({ username: 'orphan', name: 'Orphan', role: 'nonsense' })).rejects.toThrow();
    expect(state.authCreated).toEqual([]);
  });
});

describe('deleteUser', () => {
  it('refuses an unknown username without touching Supabase', async () => {
    const { deleteUser } = await load();
    await expect(deleteUser('nobody')).rejects.toThrow(/not found/i);
    expect(state.authDeleted).toEqual([]);
  });

  it('refuses to delete a Superadmin when the caller is an Admin', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { deleteUser } = await load();

    await expect(deleteUser('superadmin')).rejects.toThrow(/only the Superadmin can delete a Superadmin/i);

    expect(state.authDeleted).toEqual([]);
    expect(state.profiles.some((p) => p.username === 'superadmin')).toBe(true);
    expect(state.spy.writesTo('profile')).toEqual([]);
  });

  it('a Superadmin CAN delete another Superadmin', async () => {
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { deleteUser } = await load();

    await deleteUser('superadmin');

    expect(state.authDeleted).toContain('u-super');
  });

  it('an Admin can still delete a Warehouse account', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { deleteUser } = await load();

    await deleteUser('wh_bajada');

    expect(state.authDeleted).toEqual(['u-wh']);
  });

  it('deletes the auth login AND the profile row', async () => {
    const { deleteUser } = await load();
    await deleteUser('wh_bajada');
    expect(state.authDeleted).toEqual(['u-wh']);
    expect(state.profiles).toHaveLength(2);
  });
});

describe('updateUserWarehouse', () => {
  it('moves a user between warehouses with no ownership check on the target', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { updateUserWarehouse } = await load();

    // 'Nowhere' was never registered — the Warehouse table is a lookup, and this
    // action never validates against it.
    await updateUserWarehouse('wh_bajada', 'Nowhere');

    expect(state.profiles.find((p) => p.username === 'wh_bajada')?.warehouse).toBe('Nowhere');
  });
});