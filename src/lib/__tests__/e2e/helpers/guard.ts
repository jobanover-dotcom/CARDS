// Database-target validation for the live-database run.
//
// Deliberately a separate, dependency-free module so it can be unit-tested in the
// DEFAULT suite (jsdom, no database, no network) while the live suite imports it
// for real. See src/lib/__tests__/e2e/helpers/guard.ts.
export interface GuardOptions {
  /** The raw URL to validate. */
  url?: string | null;
  /**
   * The explicit opt-in that permits a non-loopback host. Never set
   * automatically. Defaults to unset, so a bare run is refused.
   */
  allowNonLocal?: string | undefined;
}

export interface GuardResult {
  ok: boolean;
  /** Loopback host that was validated, or null when there is none. */
  host: string | null;
  /** True when the host is loopback and therefore safe for a disposable run. */
  loopback: boolean;
  /** True when a non-loopback host was accepted via the explicit override. */
  overridden: boolean;
  /** Operator-facing reason. Never contains the URL or any credential. */
  reason: string;
}

/** Loopback names and literals that genuinely resolve to this machine. */
const LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/** IPv6 loopback is the only IPv6 range treated as local (::1/128). */
function isLoopbackIPv6(host: string): boolean {
  // Accept the bracketed form a URL parser can hand back, and the bare form.
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return bare === '::1' || bare === '0:0:0:0:0:0:0:1';
}

function isLoopbackIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  return octets[0] === 127;
}

/**
 * Validate the live-run database target.
 *
 * The hazard this exists for: `dotenv/config` loads `.env`, which in this
 * repository points at the PRODUCTION Supabase project. A bare
 * `npm run test:e2e:live` would therefore silently write to production. The
 * `CARDS_E2E_LIVE` opt-in and the CI gate control WHETHER the suite runs; this
 * controls WHICH DATABASE it may run against.
 *
 * Parsing is done with `URL`, never a substring test, so a hostile or careless
 * value cannot smuggle a remote host past a naive `includes('127.0.0.1')` check.
 */
export function evaluateDatabaseTarget({ url, allowNonLocal }: GuardOptions): GuardResult {
  const raw = (url ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      host: null,
      loopback: false,
      overridden: false,
      reason: 'DATABASE_URL is not set. The live E2E run needs a database; copy .env.example to .env first.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      host: null,
      loopback: false,
      overridden: false,
      reason: 'DATABASE_URL could not be parsed as a URL. Refusing to run rather than guess the target.',
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    return {
      ok: false,
      host: null,
      loopback: false,
      overridden: false,
      reason: `DATABASE_URL uses an unexpected scheme "${protocol}". Expected postgresql:. Refusing to run.`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return {
      ok: false,
      host: null,
      loopback: false,
      overridden: false,
      reason: 'DATABASE_URL has no hostname. Refusing to run.',
    };
  }

  const loopback = LOOPBACK_NAMES.has(host) || isLoopbackIPv4(host) || isLoopbackIPv6(host);

  if (loopback) {
    return {
      ok: true,
      host,
      loopback: true,
      overridden: false,
      reason: 'DATABASE_URL points at a loopback host.',
    };
  }

  if (allowNonLocal === 'yes') {
    return {
      ok: true,
      host,
      loopback: false,
      overridden: true,
      reason: 'Non-loopback host accepted by explicit CARDS_E2E_ALLOW_NONLOCAL=yes opt-in.',
    };
  }

  return {
    ok: false,
    host,
    loopback: false,
    overridden: false,
    reason:
      `Refusing to run against the non-loopback database host "${host}". ` +
      'The live E2E suite writes to the database it targets; this repository\'s .env points at ' +
      'production, so it would be reached silently. Point DATABASE_URL at a disposable local ' +
      'database, or set CARDS_E2E_ALLOW_NONLOCAL=yes to accept the risk deliberately.',
  };
}

/**
 * Throw unless the configured target is safe. Returns the validated host.
 *
 * The message never contains the URL or any credential.
 */
export function assertSafeDatabaseTarget(options: GuardOptions): string {
  const result = evaluateDatabaseTarget(options);
  if (!result.ok) throw new Error(result.reason);
  return result.host ?? '';
}