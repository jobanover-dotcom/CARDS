import { beforeEach, describe, expect, it } from 'vitest';

import {
  PREFIX,
  RUN_NAMESPACE,
  assertNoCollisions,
  assertNoResidue,
  cleanupOwned,
  createTracker,
  fingerprint,
  findResidue,
  nextMrsNo,
  nextPoNumber,
} from './e2e/helpers/harness';

// Cleanup and collision safety, exercised against a fake Prisma client. No
// PostgreSQL, no Supabase, no network.

/** Minimal in-memory stand-in recording exactly what the harness deleted. */
function fakePrisma(seed: { pos?: any[]; audit?: any[]; flags?: any[]; reqs?: any[] } = {}) {
  const pos = seed.pos ?? [];
  const audit = seed.audit ?? [];
  const flags = seed.flags ?? [];
  const reqs = seed.reqs ?? [];
  const deletions: { model: string; where: any }[] = [];
  let failNext = false;

  const matchIn = (where: any, field: string, rows: any[]) =>
    Array.isArray(where?.[field]?.in) ? rows.filter((r) => where[field].in.includes(r[field])) : rows;

  return {
    deletions,
    failOnce() {
      failNext = true;
    },
    state: { pos, audit, flags, reqs },
    client: {
      purchaseOrder: {
        findMany: async (args: any) => {
          const w = args?.where?.poNumber ?? {};
          if (w.startsWith) return pos.filter((r) => r.poNumber.startsWith(w.startsWith));
          if (w.not?.startsWith) return pos.filter((r) => !r.poNumber.startsWith(w.not.startsWith));
          return matchIn(args?.where, 'poNumber', pos);
        },
        deleteMany: async (args: any) => {
          if (failNext) {
            failNext = false;
            throw new Error('simulated delete failure');
          }
          deletions.push({ model: 'purchaseOrder', where: args.where });
          const victims = matchIn(args.where, 'poNumber', pos);
          for (const v of victims) pos.splice(pos.indexOf(v), 1);
          return { count: victims.length };
        },
      },
      deliveryAuditLog: {
        findMany: async (args: any) => {
          const rows = matchIn(args?.where, 'poNumber', audit);
          return args?.where?.poNumber?.startsWith
            ? rows.filter((r) => String(r.poNumber).startsWith(args.where.poNumber.startsWith))
            : rows;
        },
        deleteMany: async (args: any) => {
          if (failNext) {
            failNext = false;
            throw new Error('simulated delete failure');
          }
          deletions.push({ model: 'deliveryAuditLog', where: args.where });
          const victims = matchIn(args.where, 'poNumber', audit);
          for (const v of victims) audit.splice(audit.indexOf(v), 1);
          return { count: victims.length };
        },
      },
      receivingDiscrepancy: {
        findMany: async (args: any) => {
          const rows = matchIn(args?.where, 'poNumber', flags);
          return args?.where?.poNumber?.startsWith
            ? rows.filter((r) => String(r.poNumber).startsWith(args.where.poNumber.startsWith))
            : rows;
        },
      },
      warehouseRequest: {
        deleteMany: async (args: any) => {
          deletions.push({ model: 'warehouseRequest', where: args.where });
          const victims = matchIn(args.where, 'reqNumber', reqs);
          for (const v of victims) reqs.splice(reqs.indexOf(v), 1);
          return { count: victims.length };
        },
      },
    },
  };
}

beforeEach(() => {
  // No module state to reset: RUN_NAMESPACE is per-process and each test builds
  // its own tracker.
});

describe('run-scoped identifiers cannot collide between runs', () => {
  it('every generated identifier carries the run namespace', () => {
    expect(nextPoNumber('alpha')).toMatch(new RegExp(`^${RUN_NAMESPACE}alpha-`));
    expect(nextMrsNo('alpha')).toMatch(new RegExp(`^${RUN_NAMESPACE}MRS-alpha-`));
  });

  it('identifiers are unique across many calls', () => {
    const seen = new Set(Array.from({ length: 500 }, () => nextPoNumber('x')));
    expect(seen.size).toBe(500);
  });

  it('the shared prefix alone does not identify ownership', () => {
    // A row can carry the prefix and still belong to a DIFFERENT run.
    expect(nextPoNumber('x').startsWith(PREFIX)).toBe(true);
    expect(nextPoNumber('x').startsWith(`${PREFIX}other-run-`)).toBe(false);
  });
});

describe('cleanup deletes only what this run tracked', () => {
  it('deletes exactly the tracked purchase orders and nothing else', async () => {
    const mine = nextPoNumber('mine');
    const other = `${PREFIX}other-run-theirs`;
    const db = fakePrisma({
      pos: [{ poNumber: mine }, { poNumber: other }, { poNumber: 'PRODUCTION-1' }],
    });
    const tracker = createTracker();
    tracker.trackPo(mine);

    const result = await cleanupOwned(db.client, tracker);

    expect(result.purchaseOrders).toBe(1);
    expect(db.state.pos.map((p: any) => p.poNumber)).toEqual([other, 'PRODUCTION-1']);
    expect(db.deletions.filter((d) => d.model === 'purchaseOrder')[0].where).toEqual({ poNumber: { in: [mine] } });
  });

  it('never issues a prefix-wide delete', async () => {
    const db = fakePrisma({ pos: [{ poNumber: nextPoNumber('a') }] });
    const tracker = createTracker();
    tracker.trackPo(db.state.pos[0].poNumber);

    await cleanupOwned(db.client, tracker);

    for (const d of db.deletions) {
      expect(JSON.stringify(d.where)).not.toContain('startsWith');
    }
  });

  it('leaves an untracked row sharing the prefix untouched', async () => {
    const mine = nextPoNumber('mine');
    const untracked = nextPoNumber('untracked');
    const db = fakePrisma({ pos: [{ poNumber: mine }, { poNumber: untracked }] });
    const tracker = createTracker();
    tracker.trackPo(mine);

    await cleanupOwned(db.client, tracker);

    expect(db.state.pos.map((p: any) => p.poNumber)).toEqual([untracked]);
  });

  it('deletes audit rows by the tracked ids, since the table has no foreign key', async () => {
    const mine = nextPoNumber('mine');
    const theirs = `${PREFIX}other-run-theirs`;
    const db = fakePrisma({
      pos: [{ poNumber: mine }],
      audit: [{ poNumber: mine }, { poNumber: theirs }],
    });
    const tracker = createTracker();
    tracker.trackPo(mine);

    const result = await cleanupOwned(db.client, tracker);

    expect(result.auditRows).toBe(1);
    expect(db.state.audit.map((a: any) => a.poNumber)).toEqual([theirs]);
  });

  it('clears the tracker so a second cleanup is a no-op', async () => {
    const db = fakePrisma({ pos: [{ poNumber: nextPoNumber('a') }] });
    const tracker = createTracker();
    tracker.trackPo(db.state.pos[0].poNumber);

    await cleanupOwned(db.client, tracker);
    const second = await cleanupOwned(db.client, tracker);

    expect(second).toEqual({ purchaseOrders: 0, requests: 0, auditRows: 0 });
  });

  it('propagates a cleanup failure instead of swallowing it', async () => {
    const db = fakePrisma({ pos: [{ poNumber: nextPoNumber('a') }] });
    const tracker = createTracker();
    tracker.trackPo(db.state.pos[0].poNumber);
    db.failOnce();

    // A cleanup that half-failed must be visible, not reported as a clean run.
    await expect(cleanupOwned(db.client, tracker)).rejects.toThrow(/simulated delete failure/);
  });
});

describe('collisions block the run', () => {
  it('starts cleanly when nothing matches', async () => {
    const db = fakePrisma({ pos: [{ poNumber: 'PRODUCTION-1' }] });
    await expect(assertNoCollisions(db.client)).resolves.toBeUndefined();
  });

  it('refuses when another run left a purchase order behind', async () => {
    const db = fakePrisma({ pos: [{ poNumber: `${PREFIX}stale-run-abc` }] });
    await expect(assertNoCollisions(db.client)).rejects.toThrow(/cannot\s+prove it owns/i);
  });

  it('names the conflicting identifiers so they can be investigated', async () => {
    const db = fakePrisma({ pos: [{ poNumber: `${PREFIX}stale-one` }, { poNumber: `${PREFIX}stale-two` }] });
    await expect(assertNoCollisions(db.client)).rejects.toThrow(/stale-one[\s\S]*stale-two/);
  });

  it('also refuses on audit or discrepancy residue, which a PO-only check would miss', async () => {
    const auditOnly = fakePrisma({ audit: [{ poNumber: `${PREFIX}stale-audit` }] });
    await expect(assertNoCollisions(auditOnly.client)).rejects.toThrow(/deliveryAuditLog/);

    const flagOnly = fakePrisma({ flags: [{ poNumber: `${PREFIX}stale-flag` }] });
    await expect(assertNoCollisions(flagOnly.client)).rejects.toThrow(/receivingDiscrepancy/);
  });

  it('never deletes the conflicting rows — they are evidence', async () => {
    const db = fakePrisma({ pos: [{ poNumber: `${PREFIX}stale-run-abc` }] });
    await expect(assertNoCollisions(db.client)).rejects.toThrow();
    expect(db.deletions).toEqual([]);
    expect(db.state.pos).toHaveLength(1);
  });
});

describe('residue is reported, never swept', () => {
  it('finds rows that survived cleanup and names them', async () => {
    const leftover = nextPoNumber('leftover');
    const db = fakePrisma({ pos: [{ poNumber: leftover }] });

    const residue = await findResidue(db.client);

    expect(residue).toEqual([{ kind: 'purchaseOrder', identifier: leftover }]);
  });

  it('assertNoResidue throws with the identifier and deletes nothing', async () => {
    const leftover = nextPoNumber('leftover');
    const db = fakePrisma({ pos: [{ poNumber: leftover }] });

    await expect(assertNoResidue(db.client)).rejects.toThrow(new RegExp(leftover));
    // The row survives, which is the entire point.
    expect(db.state.pos).toHaveLength(1);
    expect(db.deletions).toEqual([]);
  });

  it('reports audit-only residue', async () => {
    const db = fakePrisma({ audit: [{ poNumber: `${PREFIX}x-audit-only` }] });
    await expect(assertNoResidue(db.client)).rejects.toThrow(/deliveryAuditLog/);
  });
});

describe('one run cannot clean another run records', () => {
  it('two trackers over one database remove only their own rows', async () => {
    const runA = nextPoNumber('runA');
    const runB = nextPoNumber('runB');
    const db = fakePrisma({ pos: [{ poNumber: runA }, { poNumber: runB }] });
    const trackerA = createTracker();
    const trackerB = createTracker();
    trackerA.trackPo(runA);
    trackerB.trackPo(runB);

    await cleanupOwned(db.client, trackerA);
    expect(db.state.pos.map((p: any) => p.poNumber)).toEqual([runB]);

    await cleanupOwned(db.client, trackerB);
    expect(db.state.pos).toHaveLength(0);
  });

  it('tracking the same id twice deletes it once', async () => {
    const id = nextPoNumber('dup');
    const db = fakePrisma({ pos: [{ poNumber: id }] });
    const tracker = createTracker();
    tracker.trackPo(id);
    tracker.trackPo(id);

    const result = await cleanupOwned(db.client, tracker);

    expect(result.purchaseOrders).toBe(1);
  });
});

describe('fingerprint ignores the test namespace', () => {
  it('does not include E2E-prefixed purchase orders', async () => {
    const db = fakePrisma({ pos: [{ poNumber: 'REAL-1', status: 'in_progress', items: [] }, { poNumber: nextPoNumber('e2e') }] });
    const before = await fingerprint(db.client);
    expect(before).toContain('REAL-1');
    expect(before).not.toContain(PREFIX);
  });
});