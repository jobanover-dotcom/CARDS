'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import DeliveryDetails from '../../../../../src/components/shared/DeliveryDetails';

function AdminDeliveryPage() {
  const params = useParams();
  return <DeliveryDetails deliveryNumber={params.deliveryNumber} backHref="/admin/purchase-orders" />;
}

export default AdminDeliveryPage;
