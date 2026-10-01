'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from './auth';

// Private bucket holding supplier DR evidence. PostgreSQL stores only the
// storage path + metadata; the service-role key never reaches the browser.
const RECEIPT_BUCKET = 'delivery-receipts';
const VIEW_URL_TTL_SECONDS = 60;
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'receipt';
}

async function assertCanAccessDelivery(deliveryNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  // Archived deliveries: Purchaser/Superadmin read-only. Warehouse has no access.
  if (user.role !== 'Admin' && user.role !== 'Superadmin') throw new Error('Unauthorized: archived deliveries are available to purchasers and superadmins only');
  const delivery = await prisma.delivery.findUnique({
    where: { deliveryNumber },
    include: { po: { select: { warehouse: true } } },
  });
  if (!delivery) throw new Error('Delivery not found');
  return { user, delivery };
}

// RETIRED: Delivery Receipt photo upload removed from the active workflow.
// Receiving records quantity + remarks only. Historical rows are preserved.
export async function getReceiptUploadUrl(deliveryNumber: string, filename: string, contentType: string) {
  throw new Error('Delivery receipt upload is retired and no longer part of the workflow.');
}

export async function recordReceipt(deliveryNumber: string, storagePath: string) {
  throw new Error('Delivery receipt upload is retired and no longer part of the workflow.');
}

export async function getReceiptViewUrl(storagePath: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const deliveryNumber = storagePath.split('/')[0];
  const { delivery } = await assertCanAccessDelivery(deliveryNumber);
  const receipt = await prisma.deliveryReceipt.findFirst({ where: { deliveryId: delivery.id, storagePath } });
  if (!receipt) throw new Error('Receipt not found');
  const supabase = await createAdminSupabase();
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(storagePath, VIEW_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not open receipt: ${error.message}`);
  return { signedUrl: data.signedUrl };
}

export async function getDeliveryReceipts(deliveryNumber: string) {
  await assertCanAccessDelivery(deliveryNumber);
  return prisma.deliveryReceipt.findMany({
    where: { delivery: { deliveryNumber } },
    orderBy: { uploadedAt: 'asc' },
  });
}
