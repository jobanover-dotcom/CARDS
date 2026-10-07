'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from './auth';

// ---------------------------------------------------------------------------
// Archived Delivery DR evidence — ARCHIVE READS ONLY.
//
// This module serves the RETIRED supplier-delivery workflow and will not accept
// new uploads: the two upload functions below throw on purpose, so a stale client
// fails loudly instead of writing archive rows.
//
// Live evidence is different. A supplier's signed delivery receipt attached to a
// purchase order now lives in actions/poReceipts.ts, stored as a
// PurchaseOrderReceipt and uploaded to this same `delivery-receipts` bucket under
// a PO-scoped path prefix. That is a deliberate, separate capability: it is
// optional, it never changes a quantity, and nothing here was reused for it.
// ---------------------------------------------------------------------------

// Shared with actions/poReceipts.ts, which writes PO-scoped paths into the same
// bucket. Keep the two names in step.
const RECEIVE_RECEIPT_BUCKET = 'delivery-receipts';
const VIEW_URL_TTL_SECONDS = 60;

async function assertCanViewArchive() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (user.role !== 'Admin' && user.role !== 'Superadmin')
    throw new Error(
      'Unauthorized: archived delivery receipts are available to purchasers and superadmins only',
    );
  return user;
}

async function resolveDeliveryForPath(storagePath: string) {
  const deliveryNumber = storagePath.split('/')[0];
  if (!deliveryNumber) throw new Error('Receipt not found');
  const delivery = await prisma.delivery.findUnique({ where: { deliveryNumber } });
  if (!delivery) throw new Error('Delivery not found');
  return { delivery, deliveryNumber };
}

/**
 * @deprecated Retired. Receiving no longer uploads supplier DR photos; use
 * recordReceiving() in actions/procurement.ts. Kept only so a stale client
 * fails loudly instead of silently writing archive rows.
 */
export async function getReceiptUploadUrl(deliveryNumber: string, filename: string, contentType: string) {
  throw new Error('Delivery receipt upload is retired: receiving is recorded against the purchase order.');
}

/**
 * @deprecated Retired alongside getReceiptUploadUrl. Historical
 * DeliveryReceipt rows are preserved and remain readable.
 */
export async function recordReceipt(deliveryNumber: string, storagePath: string) {
  throw new Error('Delivery receipt upload is retired: receiving is recorded against the purchase order.');
}

/** Signed read URL for an archived receipt. Purchaser / Superadmin only. */
export async function getReceiptViewUrl(storagePath: string) {
  await assertCanViewArchive();
  const { delivery } = await resolveDeliveryForPath(storagePath);
  const receipt = await prisma.deliveryReceipt.findFirst({ where: { deliveryId: delivery.id, storagePath } });
  if (!receipt) throw new Error('Receipt not found');
  const supabase = await createAdminSupabase();
  const { data, error } = await supabase.storage
    .from(RECEIVE_RECEIPT_BUCKET)
    .createSignedUrl(storagePath, VIEW_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not open receipt: ${error.message}`);
  return { signedUrl: data.signedUrl };
}

/** Archived receipts for a delivery, oldest first. Purchaser / Superadmin only. */
export async function getDeliveryReceipts(deliveryNumber: string) {
  await assertCanViewArchive();
  return prisma.deliveryReceipt.findMany({
    where: { delivery: { deliveryNumber } },
    orderBy: { uploadedAt: 'asc' },
  });
}
