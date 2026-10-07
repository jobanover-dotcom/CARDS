'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from './auth';

// ---------------------------------------------------------------------------
// Supplier delivery receipts — evidence for a purchase order.
//
// When the supplier hands over the goods they hand over a signed delivery
// receipt, and that document is the only evidence of how many units were really
// purchased. The warehouse attaches it while recording what arrived; purchasers
// read it back when they need to see why a PO says it was received.
//
// Two deliberate boundaries:
//
//   * OPTIONAL. Nothing here is required to record a receiving event or to
//     complete a PO. A delivery that arrives before the supplier issues the
//     document must still be recordable. Evidence is what you attach when you
//     have it.
//
//   * NOT a quantity input. The canonical chain in src/lib/deliveryQuantities.ts
//     remains the only source of what CARDS believes arrived. A receipt never
//     changes a quantity; it evidences one.
//
// Uploads go through a signed Storage URL rather than a server-action body.
// next.config.js sets no `serverActions.bodySizeLimit`, so Next 15's 1 MB default
// would cap a base64 payload at roughly 750 KB — smaller than a phone photo.
// The bytes therefore go straight from the browser to Storage, and only the path
// comes back through a server action.
// ---------------------------------------------------------------------------

/**
 * The bucket already holds archived DeliveryReceipt objects, so PO receipts reuse
 * it under a PO-scoped path prefix rather than requiring a new bucket to be
 * created in Supabase by hand.
 */
const RECEIPT_BUCKET = 'delivery-receipts';
const VIEW_URL_TTL_SECONDS = 60;

/**
 * Only formats a browser can render inline. SVG and HEIC are excluded: SVG is
 * active content and would render in the app's origin; HEIC is not viewable in a
 * browser at all, so attaching one would produce evidence nobody can open.
 */
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Ownership rule for reading a PO's receipts: the warehouse that owns it, or any
 * purchaser.
 *
 * This mirrors assertWarehouseOwns() in actions/procurement.ts rather than
 * importing it: that helper is private, and exporting it would turn an internal
 * guard into a publicly callable server action. Keep the two in step.
 */
async function assertCanAccessPO(
  poNumber: string,
): Promise<{ role: string; username: string; po: { warehouse: string } }> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse)
    throw new Error('Unauthorized: purchase order belongs to another warehouse');
  return { role: user.role, username: user.username, po };
}

/** Only the owning warehouse may attach evidence; purchasers never upload. */
async function assertCanUploadReceipt(poNumber: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Warehouse')
    throw new Error('Unauthorized: only warehouse users can attach a supplier receipt');
  await assertCanAccessPO(poNumber);
  return user.username;
}

/**
 * Strip path characters so a filename can never escape its PO prefix.
 *
 * Dots are kept because they carry the extension, but any run of them is
 * collapsed and none may lead: without that, a name like `../../PO-0002/x.png`
 * would keep its `..` segments and read as a traversal to anyone auditing a
 * stored path.
 */
function safeName(fileName: string): string {
  const cleaned = (fileName ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(-80);
  return cleaned || 'receipt';
}

/** Every path for a PO is namespaced by its number, and that is enforced again
 *  when the row is recorded, so a client cannot attach another PO's object. */
function storagePathFor(poNumber: string, fileName: string): string {
  return `${poNumber}/${crypto.randomUUID()}-${safeName(fileName)}`;
}

export interface ReceiptUploadTicket {
  storagePath: string;
  bucket: string;
  signedUrl: string;
  token: string;
}

/**
 * Mint a signed upload URL for one receipt image.
 *
 * The caller then uploads the bytes with the browser Supabase client and calls
 * recordPurchaseOrderReceipt with the returned path.
 */
export async function getPurchaseOrderReceiptUploadUrl(input: {
  poNumber: string;
  fileName: string;
  contentType: string;
}): Promise<ReceiptUploadTicket> {
  await assertCanUploadReceipt(input.poNumber);
  if (!ALLOWED_TYPES.includes(input.contentType as (typeof ALLOWED_TYPES)[number]))
    throw new Error(
      `Unsupported file type. Attach a ${ALLOWED_TYPES.join(', ')} image of the delivery receipt.`,
    );
  const storagePath = storagePathFor(input.poNumber, input.fileName);
  const supabase = await createAdminSupabase();
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) throw new Error(`Could not prepare the upload: ${error.message}`);
  return {
    storagePath,
    bucket: RECEIPT_BUCKET,
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export interface PurchaseOrderReceiptRow {
  id: string;
  poNumber: string;
  storagePath: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** Record that a receipt object now exists for this PO. */
export async function recordPurchaseOrderReceipt(input: {
  poNumber: string;
  storagePath: string;
}): Promise<PurchaseOrderReceiptRow> {
  const username = await assertCanUploadReceipt(input.poNumber);
  // The ticket is the authority on where an object may live. Re-checking the
  // prefix here stops a client from claiming some other PO's object as its own
  // evidence.
  if (!input.storagePath?.startsWith(`${input.poNumber}/`))
    throw new Error('Receipt does not belong to this purchase order');
  const row = await prisma.purchaseOrderReceipt.create({
    data: { poNumber: input.poNumber, storagePath: input.storagePath, uploadedBy: username },
  });
  return { ...row, uploadedAt: row.uploadedAt.toISOString() };
}

/** Receipts for a PO, newest first. Owning warehouse or any purchaser. */
export async function getPurchaseOrderReceipts(
  poNumber: string,
): Promise<PurchaseOrderReceiptRow[]> {
  await assertCanAccessPO(poNumber);
  const rows = await prisma.purchaseOrderReceipt.findMany({
    where: { poNumber },
    orderBy: { uploadedAt: 'desc' },
  });
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
}

/** How many receipts a PO holds, so a table can decide whether to offer them. */
export async function getPurchaseOrderReceiptCounts(
  poNumbers: string[],
): Promise<Record<string, number>> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (!poNumbers.length) return {};
  const scope =
    user.role === 'Warehouse' ? { po: { warehouse: user.warehouse ?? undefined } } : {};
  const rows = await prisma.purchaseOrderReceipt.findMany({
    where: { poNumber: { in: poNumbers }, ...scope },
    select: { poNumber: true },
  });
  // Seeded at zero for every PO asked about, so a caller comparing with `=== 0`
  // never has to reason about an absent key. A PO with no receipt is the normal
  // case, not an exception.
  const counts: Record<string, number> = Object.fromEntries(poNumbers.map((n) => [n, 0]));
  for (const r of rows) counts[r.poNumber] = (counts[r.poNumber] ?? 0) + 1;
  return counts;
}

/** Short-lived signed read URL. Owning warehouse or any purchaser. */
export async function getPurchaseOrderReceiptUrl(
  storagePath: string,
  poNumber: string,
): Promise<{ signedUrl: string }> {
  await assertCanAccessPO(poNumber);
  const receipt = await prisma.purchaseOrderReceipt.findFirst({
    where: { poNumber, storagePath },
    select: { storagePath: true },
  });
  if (!receipt) throw new Error('Receipt not found');
  const supabase = await createAdminSupabase();
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(storagePath, VIEW_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not open the receipt: ${error.message}`);
  return { signedUrl: data.signedUrl };
}