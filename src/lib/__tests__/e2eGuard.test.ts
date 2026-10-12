import { describe, expect, it } from 'vitest';

import { assertSafeDatabaseTarget, evaluateDatabaseTarget } from './e2e/helpers/guard';

// The live run loads `.env`, which in this repository points at the PRODUCTION
// Supabase project. `CARDS_E2E_LIVE` decides WHETHER the suite runs; this guard
// decides WHICH DATABASE it may run against. These tests run in the default
// suite — no database, no network, no credentials.

describe('a loopback target is accepted', () => {
  it('accepts an IPv4 loopback URL', () => {
    const r = evaluateDatabaseTarget({ url: 'postgresql://cards_phase5:pw@127.0.0.1:55432/cards_phase5' });
    expect(r.ok).toBe(true);
    expect(r.loopback).toBe(true);
    expect(r.host).toBe('127.0.0.1');
  });

  it('accepts localhost', () => {
    const r = evaluateDatabaseTarget({ url: 'postgresql://user:pw@localhost:5432/cards' });
    expect(r.ok).toBe(true);
    expect(r.loopback).toBe(true);
  });

  it('accepts any 127.x.x.x address, not just 127.0.0.1', () => {
    for (const host of ['127.0.0.1', '127.0.0.53', '127.1.2.3']) {
      expect(evaluateDatabaseTarget({ url: `postgresql://u:p@${host}:5432/db` }).ok, host).toBe(true);
    }
  });

  it('accepts the IPv6 loopback', () => {
    // The URL parser normalises the expanded spelling to ::1 and keeps the
    // brackets; the guard strips them before comparing.
    expect(evaluateDatabaseTarget({ url: 'postgresql://u:p@[::1]:5432/db' }).ok).toBe(true);
    expect(evaluateDatabaseTarget({ url: 'postgresql://u:p@[0:0:0:0:0:0:0:1]:5432/db' }).ok).toBe(true);
  });

  it('refuses an unbracketed IPv6 authority, which is not a parseable URL', () => {
    // `postgresql://u:p@::1:5432/db` is ambiguous and has no valid parse, so it
    // is refused as malformed rather than silently reinterpreted.
    const r = evaluateDatabaseTarget({ url: 'postgresql://u:p@::1:5432/db' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parsed/i);
  });

  it('refuses a non-loopback IPv6 address', () => {
    expect(evaluateDatabaseTarget({ url: 'postgresql://u:p@[2001:db8::1]:5432/db' }).ok).toBe(false);
    // fe80::/10 link-local is not loopback either.
    expect(evaluateDatabaseTarget({ url: 'postgresql://u:p@[fe80::1]:5432/db' }).ok).toBe(false);
  });

  it('accepts a loopback name on a non-default port with no scheme suffix', () => {
    expect(evaluateDatabaseTarget({ url: 'postgres://u:p@127.0.0.1:55432/db' }).ok).toBe(true);
  });
});

describe('a remote target is refused by default', () => {
  it('refuses a Supabase pooler host', () => {
    const r = evaluateDatabaseTarget({
      url: 'postgresql://postgres.abc123:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    });
    expect(r.ok).toBe(false);
    expect(r.loopback).toBe(false);
    expect(r.overridden).toBe(false);
    expect(r.reason).toMatch(/non-loopback/i);
  });

  it('refuses a plain Supabase project host', () => {
    const r = evaluateDatabaseTarget({ url: 'postgresql://u:p@abcdefghijkl.supabase.co:5432/postgres' });
    expect(r.ok).toBe(false);
  });

  it('refuses arbitrary remote hosts and public addresses', () => {
    for (const host of ['db.example.com', '10.0.0.5', '192.168.1.20', '8.8.8.8', '[2001:db8::1]']) {
      const r = evaluateDatabaseTarget({ url: `postgresql://u:p@${host}:5432/db` });
      expect(r.ok, host).toBe(false);
      expect(r.overridden, host).toBe(false);
    }
  });

  it('refuses the IPv4 link-local range, which is not loopback', () => {
    expect(evaluateDatabaseTarget({ url: 'postgresql://u:p@169.254.169.254:5432/db' }).ok).toBe(false);
  });
});

describe('lookalikes cannot smuggle a remote host past the guard', () => {
  it('refuses a hostname merely CONTAINING 127.0.0.1', () => {
    const r = evaluateDatabaseTarget({ url: 'postgresql://u:p@evil-127.0.0.1.example.com:5432/db' });
    expect(r.ok).toBe(false);
    expect(r.host).toBe('evil-127.0.0.1.example.com');
  });

  it('refuses a hostname merely PREFIXED with localhost', () => {
    for (const host of ['localhost.evil.com', 'notlocalhost', 'localhostx']) {
      expect(evaluateDatabaseTarget({ url: `postgresql://u:p@${host}:5432/db` }).ok, host).toBe(false);
    }
  });

  it('refuses a remote host hidden in the path or query while the host is loopback', () => {
    // The host is what is authoritative; a lookalike elsewhere is harmless but
    // must not be what the check keys on.
    const r = evaluateDatabaseTarget({
      url: 'postgresql://u:p@127.0.0.1:55432/db?host=evil.example.com',
    });
    expect(r.ok).toBe(true);
    expect(r.host).toBe('127.0.0.1');
  });

  it('refuses a userinfo section that tries to pass off a remote authority', () => {
    // `real.host` here is USER INFO, not the host. The real host is 127.0.0.1.
    const r = evaluateDatabaseTarget({ url: 'postgresql://real.host:5432@127.0.0.1:55432/db' });
    expect(r.ok).toBe(true);
    expect(r.host).toBe('127.0.0.1');
  });
});

describe('malformed and missing input is refused rather than guessed', () => {
  it('refuses an empty or missing URL', () => {
    for (const url of [undefined, null, '', '   ']) {
      const r = evaluateDatabaseTarget({ url: url as any });
      expect(r.ok, String(url)).toBe(false);
      expect(r.reason).toMatch(/not set/i);
    }
  });

  it('refuses a value that is not a URL at all', () => {
    expect(evaluateDatabaseTarget({ url: 'not a url at all' }).ok).toBe(false);
    expect(evaluateDatabaseTarget({ url: 'postgres://' }).ok).toBe(false);
  });

  it('refuses an unexpected scheme', () => {
    for (const url of ['http://127.0.0.1:5432/db', 'mysql://127.0.0.1/db', 'file:///etc/passwd']) {
      const r = evaluateDatabaseTarget({ url });
      expect(r.ok, url).toBe(false);
      expect(r.reason).toMatch(/scheme/i);
    }
  });
});

describe('the non-loopback override is explicit and exact', () => {
  it('accepts a remote host only when the override is exactly "yes"', () => {
    const url = 'postgresql://u:p@db.example.com:5432/db';
    expect(evaluateDatabaseTarget({ url }).ok).toBe(false);
    for (const bad of ['no', 'YES', 'true', '1', 'y', '']) {
      expect(evaluateDatabaseTarget({ url, allowNonLocal: bad }).ok, bad).toBe(false);
    }
    const allowed = evaluateDatabaseTarget({ url, allowNonLocal: 'yes' });
    expect(allowed.ok).toBe(true);
    expect(allowed.loopback).toBe(false);
    expect(allowed.overridden).toBe(true);
  });

  it('never treats the override as authorisation when the URL is unusable', () => {
    // An override does not rescue a malformed or missing URL.
    expect(evaluateDatabaseTarget({ url: 'garbage', allowNonLocal: 'yes' }).ok).toBe(false);
    expect(evaluateDatabaseTarget({ url: '', allowNonLocal: 'yes' }).ok).toBe(false);
  });
});

describe('no result leaks a credential', () => {
  it('never includes the password or the full URL in the reason', () => {
    const secret = 'hunter2-SUPER-SECRET';
    const r = evaluateDatabaseTarget({ url: `postgresql://user:${secret}@db.example.com:5432/db` });
    expect(r.reason).not.toContain(secret);
    expect(r.reason).not.toContain('postgresql://');
    expect(JSON.stringify(r)).not.toContain(secret);
  });
});

describe('assertSafeDatabaseTarget', () => {
  it('returns the validated loopback host', () => {
    expect(assertSafeDatabaseTarget({ url: 'postgresql://u:p@127.0.0.1:55432/db' })).toBe('127.0.0.1');
  });

  it('throws for a remote target', () => {
    expect(() =>
      assertSafeDatabaseTarget({ url: 'postgresql://u:p@db.example.com:5432/db' }),
    ).toThrow(/non-loopback/i);
  });

  it('throws before anything can open a connection', () => {
    // The live setup calls this at module scope, so a refusal aborts collection.
    expect(() => assertSafeDatabaseTarget({ url: undefined })).toThrow(/not set/i);
  });
});