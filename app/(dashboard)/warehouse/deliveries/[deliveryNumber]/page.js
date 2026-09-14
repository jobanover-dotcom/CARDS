'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import DeliveryDetails from '../../../../../src/components/shared/DeliveryDetails';

function WarehouseDeliveryPage() {
  const params = useParams();
  return <DeliveryDetails deliveryNumber={params.deliveryNumber} backHref="/warehouse" />;
}

export default WarehouseDeliveryPage;
