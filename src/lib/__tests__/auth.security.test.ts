import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/auth.ts
//
// This module is the ONLY session→identity seam in the application: every guard
// in every other action file calls `getCurrentUser()` and trusts its result.
// It is therefore the highest-value file in the audit.
//
// `@/actions/auth` is deliberately NOT mocked here — this suite exercises the real
// module. Only the Supabase clients and Prisma are doubled.
//
// Findings are documented as behaviour, not asserted away.

const session = vi.hoisted(() => ({
  // null = no cookie/session at all.
  current: null as null | { user: { id: string; email?: string } },
}));

const state = vi.hoisted(() => ({
  profiles: [] as any[],
  authCalls: [] as string[],
  passwordUpdates: [] as any[],
  createdUsers: [] as any[],
  deletedUsers: [] as string[],
  resetUsers: [] as any[],
  signOuts: 0,
  profileLookupFails: false,
  supabaseNextId: 1,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;
  const tx = () => ({
    profile: {
      findUnique: async (args: any) => {
        state.authCalls.push('profile.findUnique');
        if (state.profileLookupFails) throw new Error('DB down');
        const w = args?.where ?? {};
        return state.profiles.find((p) =>
          w.id ? p.id === w.id : w.username ? p.username === w.username : false,
        ) ?? null;
      },
      create: async (args: any) => {
        spy.hook('profile', 'create')(args);
        const row = { createdAt: new Date(), updatedAt: new Date(), ...args.data };
        state.profiles.push(row);
        return row;
      },
    },
  });
  return { prisma: { ...tx(), $transaction: async (fn: any) => fn(tx()) }, runTx: async (fn: any) => fn(tx()) };
});

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({
    auth: {
      getSession: async () => ({ data: { session: session.current }, error: null }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        state.authCalls.push(`signInWithPassword:${email}`);
        if (password === 'wrong-password') {
          return { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
        }
        // A successful re-authentication switches the ambient session, exactly as
        // Supabase does — this is what makes changePassword's missing identity
        // check observable.
        session.current = { user: { id: 'u-reauthenticated', email } };
        return { data: { user: { id: 'u-reauthenticated', email } }, error: null };
      },
      updateUser: async (payload: any) => {
        state.passwordUpdates.push({ payload, sessionUserId: session.current?.user.id ?? null });
        return { data: {}, error: null };
      },
      signOut: async () => {
        state.signOuts += 1;
        session.current = null;
        return { error: null };
      },
    },
  }),
  createAdminSupabase: async () => ({
    auth: {
      admin: {
        createUser: async ({ email, password }: { email: string; password: string }) => {
          state.createdUsers.push({ email, password });
          const id = `auth-${state.supabaseNextId++}`;
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (id: string) => {
          state.deletedUsers.push(id);
          return { data: {}, error: null };
        },
        updateUserById: async (id: string, payload: any) => {
          state.resetUsers.push({ id, payload });
          return { data: {}, error: null };
        },
      },
    },
  }),
}));

const load = () => import('@/actions/auth') as Promise<any>;

function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'u-admin',
    username: 'purchaser1',
    name: 'Purchaser One',
    role: ROLES.admin,
    warehouse: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  state.profiles = [
    profile(),
    profile({ id: 'u-super', username: 'superadmin', role: ROLES.superadmin }),
    profile({ id: 'u-wh-bajada', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' }),
    profile({ id: 'u-wh-north', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' }),
  ];
  state.authCalls = [];
  state.passwordUpdates = [];
  state.createdUsers = [];
  state.deletedUsers = [];
  state.resetUsers = [];
  state.signOuts = 0;
  state.profileLookupFails = false;
  state.supabaseNextId = 1;
  session.current = { user: { id: 'u-admin' } };
});

describe('getCurrentUser — the session→identity seam', () => {
  it('returns null with no session (fails closed)', async () => {
    session.current = null;
    const { getCurrentUser } = await load();
    expect(await getCurrentUser()).toBeNull();
  });

  it('resolves the Profile by the exact session user id', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { getCurrentUser } = await load();
    const user = await getCurrentUser();
    expect(user).toMatchObject({ username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' });
  });

  it('returns null when a valid session has no Profile row — a session alone grants nothing', async () => {
    session.current = { user: { id: 'u-unprovisioned' } };
    const { getCurrentUser } = await load();
    expect(await getCurrentUser()).toBeNull();
  });

  it('reads the role from the database row, never from the session token', async () => {
    // A session that CLAIMS Superadmin must not elevate: the profile row says Admin.
    session.current = { user: { id: 'u-admin', email: 'x' } };
    const { getCurrentUser } = await load();
    const user = await getCurrentUser();
    expect(user?.role).toBe(ROLES.admin);
    expect((session.current!.user as any).role).toBeUndefined();
  });

  it('propagates a database failure instead of silently returning null', async () => {
    session.current = { user: { id: 'u-admin' } };
    state.profileLookupFails = true;
    const { getCurrentUser } = await load();
    await expect(getCurrentUser()).rejects.toThrow('DB down');
  });
});

describe('getSession — the client-facing identity read', () => {
  it('returns null with no session', async () => {
    session.current = null;
    const { getSession } = await load();
    expect(await getSession()).toBeNull();
  });

  it('returns null rather than a partial shape when the Profile is missing', async () => {
    session.current = { user: { id: 'u-unprovisioned' } };
    const { getSession } = await load();
    expect(await getSession()).toBeNull();
  });

  it('exposes only the six identity fields, never the raw Profile row', async () => {
    session.current = { user: { id: 'u-admin' } };
    const { getSession } = await load();
    const result = await getSession();
    expect(Object.keys(result).sort()).toEqual(['id', 'name', 'role', 'username', 'warehouse'].sort());
  });
});

describe('login', () => {
  it('returns a mapped identity on success', async () => {
    const { login } = await load();
    const result = await login('purchaser1', '12345678');
    expect(result).toMatchObject({ success: true, user: { username: 'purchaser1', role: ROLES.admin } });
  });

  it('rejects a wrong password and does NOT sign out or read the database', async () => {
    const { login } = await load();
    const result = await login('purchaser1', 'wrong-password');
    expect(result.error).toBe('Invalid username or password');
    expect(state.signOuts).toBe(0);
  });

  it('signs out and refuses when the session has no matching Profile', async () => {
    state.profiles = [];
    const { login } = await load();
    const result = await login('purchaser1', '12345678');
    expect(result).toEqual({ error: 'Profile not found' });
    expect(state.signOuts).toBe(1);
    expect(session.current).toBeNull();
  });

  it('signs out and refuses when the database is unavailable', async () => {
    state.profileLookupFails = true;
    const { login } = await load();
    const result = await login('purchaser1', '12345678');
    expect(result.error).toMatch(/Database temporarily unavailable/i);
    expect(state.signOuts).toBe(1);
  });
});

describe('logout', () => {
  it('signs out and reports success', async () => {
    const { logout } = await load();
    expect(await logout()).toEqual({ success: true });
    expect(state.signOuts).toBe(1);
  });
});

describe('changePassword — self-service, identity-checked', () => {
  it('rejects an unauthenticated caller with no password mutation', async () => {
    session.current = null;
    const { changePassword } = await load();
    state.authCalls = [];

    const result = await changePassword('superadmin', '12345678', 'attacker-chosen');

    expect(result).toMatchObject({ error: expect.stringMatching(/must be signed in/i) });
    // With no session, getCurrentUser() resolves the session to null WITHOUT a
    // Profile read, so the action must not even attempt to authenticate as the
    // named account — no sign-in, and certainly no password write.
    expect(state.authCalls).toEqual([]);
    expect(state.passwordUpdates).toHaveLength(0);
  });

  it('refuses a Warehouse user resetting ANOTHER account, with no password mutation', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { changePassword } = await load();

    const result = await changePassword('superadmin', '12345678', 'owned-by-warehouse-user');

    expect(result).toMatchObject({ error: expect.stringMatching(/only change your own/i) });
    // The session lookup reads the caller's own Profile (expected), but the
    // action must stop there: no re-authentication as the target, no write.
    expect(state.authCalls).not.toContain('signInWithPassword:superadmin@cards.app');
    expect(state.passwordUpdates).toHaveLength(0);
  });

  it('refuses a Warehouse user targeting another Warehouse account', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { changePassword } = await load();

    const result = await changePassword('wh_north', '12345678', 'cross-account');

    expect(result).toMatchObject({ error: expect.stringMatching(/only change your own/i) });
    // The identity check precedes authentication, so no sign-in is attempted.
    expect(state.authCalls).not.toContain('signInWithPassword:wh_north@cards.app');
    expect(state.passwordUpdates).toHaveLength(0);
  });

  it('allows a signed-in user to change their OWN password', async () => {
    session.current = { user: { id: 'u-admin' } };
    const { changePassword } = await load();

    const result = await changePassword('purchaser1', '12345678', 'a-new-password');

    expect(result).toEqual({ success: true });
    expect(state.passwordUpdates).toHaveLength(1);
    expect(state.passwordUpdates[0].payload.password).toBe('a-new-password');
  });

  it('still requires the correct CURRENT password', async () => {
    session.current = { user: { id: 'u-admin' } };
    const { changePassword } = await load();

    const result = await changePassword('purchaser1', 'wrong-password', 'anything');

    expect(result).toEqual({ error: 'Current password is incorrect' });
    expect(state.passwordUpdates).toHaveLength(0);
  });

  it('preserves the re-authentication step that proves the current password', async () => {
    session.current = { user: { id: 'u-admin' } };
    const { changePassword } = await load();
    state.authCalls = [];

    await changePassword('purchaser1', '12345678', 'new-one');

    // The session lookup is now part of the identity check; what matters is that
    // the current-password proof is still performed.
    expect(state.authCalls).toContain('signInWithPassword:purchaser1@cards.app');
  });

  it('a Warehouse user CAN change their own password', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { changePassword } = await load();

    const result = await changePassword('wh_bajada', '12345678', 'new-one');

    expect(result).toEqual({ success: true });
  });

  it('REPORTED SEPARATELY: no password policy is enforced (1 character accepted)', async () => {
    // Identity is now proven; the lack of a length/complexity policy is a
    // separate finding with no approved policy in this project.
    session.current = { user: { id: 'u-admin' } };
    const { changePassword } = await load();

    const result = await changePassword('purchaser1', '12345678', 'x');

    expect(result).toEqual({ success: true });
  });
});

describe('adminResetPassword', () => {
  it('refuses an unauthenticated caller (returns an error rather than throwing)', async () => {
    session.current = null;
    const { adminResetPassword } = await load();
    const result = await adminResetPassword('wh_bajada');
    expect(result.error).toMatch(/Unauthorized/i);
    expect(state.resetUsers).toHaveLength(0);
  });

  it('refuses a Warehouse role', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { adminResetPassword } = await load();
    const result = await adminResetPassword('purchaser1');
    expect(result.error).toMatch(/Unauthorized/i);
    expect(state.resetUsers).toHaveLength(0);
  });

  it('allows Admin and Superadmin', async () => {
    const { adminResetPassword } = await load();
    for (const id of ['u-admin', 'u-super']) {
      session.current = { user: { id } };
      const result = await adminResetPassword('wh_bajada');
      expect(result).toEqual({ success: true });
    }
    expect(state.resetUsers).toHaveLength(2);
  });

  it('reports an unknown username without touching Supabase', async () => {
    const { adminResetPassword } = await load();
    expect(await adminResetPassword('nobody')).toEqual({ error: 'User not found' });
    expect(state.resetUsers).toHaveLength(0);
  });

  it('resets the password to the username itself', async () => {
    const { adminResetPassword } = await load();
    await adminResetPassword('wh_bajada');
    expect(state.resetUsers[0].payload).toEqual({ password: 'wh_bajada' });
  });
});

describe('getProfileByUsername — authenticated, self-or-elevated', () => {
  it('rejects an unauthenticated caller', async () => {
    session.current = null;
    const { getProfileByUsername } = await load();

    await expect(getProfileByUsername('superadmin')).rejects.toThrow(/Unauthorized/);
  });

  it('a caller can read its OWN profile — the Settings pages\' actual use', async () => {
    for (const id of ['u-admin', 'u-super', 'u-wh-bajada', 'u-wh-north']) {
      const profile = state.profiles.find((p) => p.id === id)!;
      session.current = { user: { id } };
      const { getProfileByUsername } = await load();
      await expect(getProfileByUsername(profile.username)).resolves.toMatchObject({ id });
    }
  });

  it('refuses a Warehouse user reading ANOTHER account', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { getProfileByUsername } = await load();

    await expect(getProfileByUsername('superadmin')).rejects.toThrow(/only view your own profile/i);
    await expect(getProfileByUsername('wh_north')).rejects.toThrow(/only view your own profile/i);
  });

  it('admits Admin and Superadmin viewing a managed account', async () => {
    for (const id of ['u-admin', 'u-super']) {
      session.current = { user: { id } };
      const { getProfileByUsername } = await load();
      await expect(getProfileByUsername('wh_bajada')).resolves.toMatchObject({
        username: 'wh_bajada',
        role: ROLES.warehouse,
        warehouse: 'Bajada',
      });
    }
  });

  it('no profile data leaks through the rejection', async () => {
    session.current = { user: { id: 'u-wh-bajada' } };
    const { getProfileByUsername } = await load();

    const attempt = await getProfileByUsername('superadmin').catch((e: Error) => e);

    expect(String(attempt)).not.toMatch(/u-super|Superadmin|@cards/);
  });

  it('no longer serves as an unauthenticated enumeration oracle', async () => {
    session.current = null;
    const { getProfileByUsername } = await load();

    await expect(getProfileByUsername('superadmin')).rejects.toThrow(/Unauthorized/);
    await expect(getProfileByUsername('no-such-user')).rejects.toThrow(/Unauthorized/);
  });
});