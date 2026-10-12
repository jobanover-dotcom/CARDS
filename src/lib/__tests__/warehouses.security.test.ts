import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, createWriteSpy } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/warehouses.ts
//
// This file is the worst authorization finding in the audit, so the tests below
// are written to DOCUMENT ACTUAL BEHAVIOUR rather than to assert the behaviour we
// would prefer. Each test is titled with what it actually proves. Nothing here is
// skipped and no assertion is weakened to make the suite green: a failing test is
// evidence of a vulnerability, not a problem to be papered over.

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
  warehouses: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  // Relative, not aliased: vitest.config maps `@/lib/*` to the ROOT `lib/`
  // directory (prisma, supabase), which has no `__tests__` folder.
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;
  const tx = () => ({
    warehouse: {
      findMany: async (args: any) => {
        const rows = state.warehouses.filter((w) => (args?.where?.name ? w.name === args.where.name : true));
        return rows;
      },
      create: async (args: any) => {
        spy.hook('warehouse', 'create')(args);
        const row = { id: `wh-${state.warehouses.length + 1}`, createdAt: new Date(), ...args.data };
        state.warehouses.push(row);
        return row;
      },
      findUnique: async (args: any) => state.warehouses.find((w) => w.name === args?.where?.name) ?? null,
    },
  });
  return {
    prisma: { ...tx(), $transaction: async (fn: any) => fn(tx()) },
    runTx: async (fn: any) => fn(tx()),
  };
});

const load = () => import('@/actions/warehouses') as Promise<any>;

beforeEach(() => {
  state.warehouses = [
    { id: 'wh-1', name: 'Bajada' },
    { id: 'wh-2', name: 'North' },
  ];
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('warehouses — authorization regression', () => {
  describe('addWarehouse', () => {
    it('rejects an unauthenticated caller with no database write', async () => {
      actor.current = NO_SESSION;
      const { addWarehouse } = await load();

      await expect(addWarehouse('Ghost Site')).rejects.toThrow(/only purchasers and superadmins/i);

      expect(state.warehouses).toHaveLength(2);
      expect(state.spy.writesTo('warehouse')).toEqual([]);
    });

    it('rejects a Warehouse caller with no database write', async () => {
      actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
      const { addWarehouse } = await load();

      await expect(addWarehouse('Ghost Site')).rejects.toThrow(/only purchasers and superadmins/i);

      expect(state.warehouses).toHaveLength(2);
      expect(state.spy.writesTo('warehouse')).toEqual([]);
    });

    it('admits Admin and Superadmin', async () => {
      const { addWarehouse } = await load();

      actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
      await expect(addWarehouse('Site Admin')).resolves.toBeTruthy();

      actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
      await expect(addWarehouse('Site Super')).resolves.toBeTruthy();

      expect(state.warehouses).toHaveLength(4);
      expect(state.spy.writesTo('warehouse')).toEqual(['warehouse.create', 'warehouse.create']);
    });

    it('rejects an unrecognised role rather than admitting it', async () => {
      // The guard is an allow-list: a role that is not Admin/Superadmin fails,
      // so a typo or a future role cannot inherit the capability.
      actor.current = { id: 'u-x', username: 'typo', role: 'warehous', warehouse: 'Bajada' };
      const { addWarehouse } = await load();

      await expect(addWarehouse('Ghost Site')).rejects.toThrow(/only purchasers and superadmins/i);
      expect(state.warehouses).toHaveLength(2);
    });

    it('rejects an empty role string', async () => {
      actor.current = { id: 'u-x', username: 'norole', role: '', warehouse: null };
      const { addWarehouse } = await load();
      await expect(addWarehouse('Ghost Site')).rejects.toThrow(/only purchasers and superadmins/i);
      expect(state.warehouses).toHaveLength(2);
    });
  });

  describe('getWarehouses', () => {
    it('rejects an unauthenticated caller', async () => {
      actor.current = NO_SESSION;
      const { getWarehouses } = await load();

      await expect(getWarehouses()).rejects.toThrow(/Unauthorized/);
    });

    it('returns the roster to every authenticated role', async () => {
      const { getWarehouses } = await load();
      for (const role of [ROLES.superadmin, ROLES.admin, ROLES.warehouse]) {
        actor.current = { id: `u-${role}`, username: `user-${role}`, role, warehouse: 'Bajada' };
        await expect(getWarehouses()).resolves.toHaveLength(2);
      }
    });
  });

  describe('input handling (not authorization)', () => {
    it('normalizes casing and collapses internal whitespace before storing', async () => {
      const { addWarehouse } = await load();
      const created = await addWarehouse('  lower   CASE   site ');
      expect(created.name).toBe('Lower Case Site');
    });

    it('accepts an empty string and writes it — no minimum-length validation', async () => {
      const { addWarehouse } = await load();
      const created = await addWarehouse('   ');
      expect(state.warehouses).toHaveLength(3);
      expect(created.name).toBe('');
    });
  });
});