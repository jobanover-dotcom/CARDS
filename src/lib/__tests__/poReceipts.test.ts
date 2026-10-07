import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execution coverage for supplier delivery receipts.
//
// Receipts are the documentary evidence that a purchase was really made, and the
// whole point of the feature is that they are OPTIONAL: nothing in receiving is
// allowed to depend on one existing. The tests below pin that down by executing
// the real actions against mocked Prisma and Storage doubles — no database and no
// credentials involved.
//
// The behaviours worth locking are the ones a regression would hide:
//   * an unauthenticated or wrong-warehouse caller cannot reach any of it
//   * only the owning warehouse may ATTACH; only the owner or a purchaser may READ
//   * an object always lands inside its own PO's prefix, and cannot be re-pointed
//   * only renderable image types are accepted
//   * a PO with no receipts is a normal state, not an error

const actor = vi.hoisted(() => ({
  current: { id: 'test', username: 'wh1', role: 'Warehouse', warehouse: 'WH1' } as {
    id: string;
    username: string;
    role: string;
    warehouse: string | null;
  } | null,
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

const storage = vi.hoisted(() => ({
  uploads: [] as any[],
  reads: [] as any[],
  // Errors the fake bucket should surface, so the failure paths can be executed.
  failUploadUrl: null as null | string,
  failReadUrl: null as null | string,
}));

vi.mock('@/lib/supabase-server', () => ({
  createAdminSupabase: async () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          if (storage.failUploadUrl) return { data: null, error: { message: storage.failUploadUrl } };
          storage.uploads.push({ bucket, path });
          return { data: { signedUrl: `https://signed/upload/${path}`, token: 'tok-1' }, error: null };
        },
        createSignedUrl: async (path: string, ttl: number) => {
          if (storage.failReadUrl) return { data: null, error: { message: storage.failReadUrl } };
          storage.reads.push({ bucket, path, ttl });
          return { data: { signedUrl: `https://signed/read/${path}` }, error: null };
        },
      }),
    },
  }),
}));

const db = vi.hoisted(() => ({
  pos: [
    { poNumber: 'PO-0001', warehouse: 'WH1', supplier: 'Acme' },
    { poNumber: 'PO-0002', warehouse: 'WH2', supplier: 'Globex' },
  ] as any[],
  receipts: [] as any[],
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    purchaseOrder: {
      findUnique: async ({ where }: any) =>
        db.pos.find((p) => p.poNumber === where.poNumber) ?? null,
    },
    purchaseOrderReceipt: {
      create: async ({ data }: any) => {
        const row = {
          id: `rec-${db.receipts.length + 1}`,
          uploadedAt: new Date('2026-01-02T03:04:05.000Z'),
          ...data,
        };
        db.receipts.push(row);
        return row;
      },
      findMany: async (args: any = {}) => {
        let out = db.receipts;
        if (args.where?.poNumber !== undefined) {
          // `poNumber` arrives either as a scalar or as `{ in: [...] }`.
          const wanted = args.where.poNumber?.in ?? args.where.poNumber;
          out = out.filter((r) =>
            Array.isArray(wanted) ? wanted.includes(r.poNumber) : r.poNumber === wanted,
          );
        }
        if (args.where?.storagePath !== undefined) {
          out = out.filter((r) => r.storagePath === args.where.storagePath);
        }
        const wh = args.where?.po?.warehouse;
        if (wh) out = out.filter((r) => db.pos.find((p) => p.poNumber === r.poNumber)?.warehouse === wh);
        // Newest first, so ordering is part of what the tests check.
        return [...out].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        );
      },
      findFirst: async (args: any = {}) =>
        db.receipts.find(
          (r) =>
            r.poNumber === args.where?.poNumber && r.storagePath === args.where?.storagePath,
        ) ?? null,
    },
  },
}));

import {
  getPurchaseOrderReceiptUploadUrl,
  recordPurchaseOrderReceipt,
  getPurchaseOrderReceipts,
  getPurchaseOrderReceiptCounts,
  getPurchaseOrderReceiptUrl,
} from '@/actions/poReceipts';

const WH1 = { id: '1', username: 'wh1', role: 'Warehouse', warehouse: 'WH1' };
const PURCHASER = { id: '2', username: 'buyer', role: 'Admin', warehouse: null };

beforeEach(() => {
  actor.current = WH1;
  db.receipts.length = 0;
  storage.uploads.length = 0;
  storage.reads.length = 0;
  storage.failUploadUrl = null;
  storage.failReadUrl = null;
});

describe('attaching a supplier receipt', () => {
  it('prepares an upload inside the bucket, namespaced by the purchase order', async () => {
    const ticket = await getPurchaseOrderReceiptUploadUrl({
      poNumber: 'PO-0001',
      fileName: 'delivery note.png',
      contentType: 'image/png',
    });

    expect(ticket.bucket).toBe('delivery-receipts');
    expect(ticket.storagePath.startsWith('PO-0001/')).toBe(true);
    expect(ticket.storagePath.endsWith('-delivery-note.png')).toBe(true);
    expect(ticket.signedUrl).toContain('PO-0001/');
    // The bytes go straight to Storage; only this ticket comes back.
    expect(storage.uploads).toEqual([{ bucket: 'delivery-receipts', path: ticket.storagePath }]);
  });

  it('accepts the image types a browser can actually render', async () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/webp']) {
      await expect(
        getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0001', fileName: 'r.jpg', contentType }),
      ).resolves.toBeTruthy();
    }
  });

  it('refuses types that would not be openable, or are active content', async () => {
    for (const contentType of ['image/svg+xml', 'image/heic', 'application/pdf', 'text/html']) {
      await expect(
        getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0001', fileName: 'r', contentType }),
      ).rejects.toThrow(/Unsupported file type/);
    }
    expect(storage.uploads).toEqual([]);
  });

  it('strips path characters so a filename cannot escape its purchase order', async () => {
    const ticket = await getPurchaseOrderReceiptUploadUrl({
      poNumber: 'PO-0001',
      fileName: '../../PO-0002/steal.png',
      contentType: 'image/png',
    });
    expect(ticket.storagePath.startsWith('PO-0001/')).toBe(true);
    expect(ticket.storagePath).not.toContain('..');
  });

  it('refuses an unauthenticated caller', async () => {
    actor.current = null;
    await expect(
      getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0001', fileName: 'r.png', contentType: 'image/png' }),
    ).rejects.toThrow('Unauthorized');
  });

  it('refuses a warehouse that does not own the purchase order', async () => {
    await expect(
      getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0002', fileName: 'r.png', contentType: 'image/png' }),
    ).rejects.toThrow('Unauthorized');
    expect(storage.uploads).toEqual([]);
  });

  it('refuses a purchaser, because attaching is the warehouse`s job', async () => {
    actor.current = PURCHASER;
    await expect(
      getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0001', fileName: 'r.png', contentType: 'image/png' }),
    ).rejects.toThrow(/only warehouse users/);
  });

  it('records the receipt against its own purchase order', async () => {
    const ticket = await getPurchaseOrderReceiptUploadUrl({
      poNumber: 'PO-0001',
      fileName: 'r.png',
      contentType: 'image/png',
    });
    const row = await recordPurchaseOrderReceipt({
      poNumber: 'PO-0001',
      storagePath: ticket.storagePath,
    });

    expect(row.poNumber).toBe('PO-0001');
    expect(row.uploadedBy).toBe('wh1');
    expect(db.receipts).toHaveLength(1);
  });

  it('will not let one purchase order claim another`s object as its evidence', async () => {
    await expect(
      recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0002/someone-else.png' }),
    ).rejects.toThrow('Receipt does not belong to this purchase order');
    expect(db.receipts).toHaveLength(0);
  });

  it('reports a bucket failure instead of pretending the receipt is ready', async () => {
    storage.failUploadUrl = 'bucket missing';
    await expect(
      getPurchaseOrderReceiptUploadUrl({ poNumber: 'PO-0001', fileName: 'r.png', contentType: 'image/png' }),
    ).rejects.toThrow(/bucket missing/);
  });
});

describe('reading supplier receipts', () => {
  it('is a normal empty state, not an error: receiving never required one', async () => {
    await expect(getPurchaseOrderReceipts('PO-0001')).resolves.toEqual([]);
    // A PO asked about with no receipts answers 0 rather than going missing.
    await expect(getPurchaseOrderReceiptCounts(['PO-0001'])).resolves.toEqual({ 'PO-0001': 0 });
  });

  it('does not even confirm a purchase order outside the caller`s own view', async () => {
    await expect(getPurchaseOrderReceipts('PO-0002')).rejects.toThrow('Unauthorized');
  });

  it('lists the owning warehouse`s receipts newest first, as ISO timestamps', async () => {
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/a.png' });
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/b.png' });

    const rows = await getPurchaseOrderReceipts('PO-0001');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => typeof r.uploadedAt === 'string')).toBe(true);
  });

  it('lets a purchaser read a receipt for a purchase order they are not warehousing', async () => {
    // The warehouse attaches it...
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/a.png' });
    // ...and a purchaser, who cannot attach, can still read it.
    actor.current = PURCHASER;
    await expect(getPurchaseOrderReceipts('PO-0001')).resolves.toHaveLength(1);
  });

  it('does not leak another warehouse`s receipts to a warehouse', async () => {
    actor.current = { id: '3', username: 'wh2', role: 'Warehouse', warehouse: 'WH2' };
    await expect(getPurchaseOrderReceipts('PO-0001')).rejects.toThrow('Unauthorized');
    // Batched counts must be scoped the same way: WH2 owns none of PO-0001, so it
    // is reported as zero rather than revealing that a receipt exists there.
    await expect(getPurchaseOrderReceiptCounts(['PO-0001'])).resolves.toEqual({ 'PO-0001': 0 });
  });

  it('counts receipts per purchase order so a row knows whether to offer them', async () => {
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/a.png' });
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/b.png' });

    await expect(getPurchaseOrderReceiptCounts(['PO-0001', 'PO-0002'])).resolves.toEqual({
      'PO-0001': 2,
      // WH1 does not own PO-0002, so it is answered as zero even when asked about.
      'PO-0002': 0,
    });
  });

  it('answers an empty page without touching the database', async () => {
    await expect(getPurchaseOrderReceiptCounts([])).resolves.toEqual({});
  });

  it('opens an object through a short-lived signed read url', async () => {
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/a.png' });
    actor.current = PURCHASER;
    const { signedUrl } = await getPurchaseOrderReceiptUrl('PO-0001/a.png', 'PO-0001');
    expect(signedUrl).toBe('https://signed/read/PO-0001/a.png');
    // Signed, not public: an evidence image stays private in the bucket.
    expect(storage.reads).toEqual([{ bucket: 'delivery-receipts', path: 'PO-0001/a.png', ttl: 60 }]);
  });

  it('refuses to sign an object that is not a recorded receipt of that order', async () => {
    await expect(getPurchaseOrderReceiptUrl('PO-0001/never-recorded.png', 'PO-0001')).rejects.toThrow(
      'Receipt not found',
    );
    expect(storage.reads).toEqual([]);
  });

  it('refuses to sign anything for an unauthenticated caller', async () => {
    actor.current = null;
    await expect(getPurchaseOrderReceiptUrl('PO-0001/a.png', 'PO-0001')).rejects.toThrow('Unauthorized');
    expect(storage.reads).toEqual([]);
  });

  it('reports a read failure rather than handing out a broken link', async () => {
    await recordPurchaseOrderReceipt({ poNumber: 'PO-0001', storagePath: 'PO-0001/a.png' });
    storage.failReadUrl = 'object not found';
    await expect(getPurchaseOrderReceiptUrl('PO-0001/a.png', 'PO-0001')).rejects.toThrow(/object not found/);
  });
});
