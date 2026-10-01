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
  const delivery = await prisma.delivery.findUnique({
    where: { deliveryNumber },
    include: { po: { select: { warehouse: true } } },
  });
  if (!delivery) throw new Error('Delivery not found');
  if (user.role === 'Warehouse' && delivery.po.warehouse !== user.warehouse) throw new Error('Unauthorized');
  return { user, delivery };
}

// Warehouse photographs the physical DR, uploads via the signed URL, then
// calls recordReceipt() so CARDS stores path metadata (not the image bytes).
export async function getReceiptUploadUrl(deliveryNumber: string, filename: string, contentType: string) {
  const { user } = await assertCanAccessDelivery(deliveryNumber);
  if (user.role !== 'Warehouse' && user.role !== 'Admin' && user.role !== 'Superadmin')
    throw new Error('Unauthorized');
  const ext = sanitizeFileName(filename).split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('Only JPG, PNG, WebP, or PDF receipts are accepted');
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(contentType)) throw new Error('Unsupported receipt content type');

  const objectName = `${deliveryNumber}/${crypto.randomUUID()}-${sanitizeFileName(filename)}`;
  const supabase = await createAdminSupabase();
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUploadUrl(objectName);
  if (error) throw new Error(`Could not prepare receipt upload: ${error.message}`);
  return { storagePath: objectName, signedUrl: data.signedUrl, token: data.token };
}

export async function recordReceipt(deliveryNumber: string, storagePath: string) {
  const { user, delivery } = await assertCanAccessDelivery(deliveryNumber);
  if (user.role !== 'Warehouse' && user.role !== 'Admin' && user.role !== 'Superadmin')
    throw new Error('Unauthorized');
  if (!storagePath.startsWith(`${deliveryNumber}/`)) throw new Error('Receipt path does not belong to this delivery');
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.deliveryReceipt.create({
      data: { deliveryId: delivery.id, storagePath, uploadedBy: user.username },
    });
    await tx.deliveryAuditLog.create({
      data: {
        deliveryId: delivery.id,
        poNumber: delivery.poNumber,
        action: 'dr_uploaded',
        detail: storagePath,
        actor: user.username,
      },
    });
    return receipt;
  });
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
