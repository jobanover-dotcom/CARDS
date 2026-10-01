'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import DeliveryDetails from '../../../../../src/components/shared/DeliveryDetails';

function PurchaserDeliveryPage() {
  const params = useParams();
  return <DeliveryDetails deliveryNumber={params.deliveryNumber} backHref="/purchaser/purchase-orders" />;
}

export default PurchaserDeliveryPage;
