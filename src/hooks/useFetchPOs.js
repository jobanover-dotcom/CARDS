import { useState } from 'react';
import { getPurchaseOrders } from '../services/api';

export function useFetchPOs() {
  const [purchaseOrders, setPurchaseOrders] = useState(getPurchaseOrders);

  const addPurchaseOrder = (newPO) => {
    setPurchaseOrders(prev => [...prev, newPO]);
  };

  const updatePurchaseOrder = (poNumber, updates) => {
    setPurchaseOrders(prev =>
      prev.map(order =>
        order.poNumber === poNumber ? { ...order, ...updates } : order
      )
    );
  };

  const getStats = () => ({
    total: purchaseOrders.length,
    completed: purchaseOrders.filter(o => o.status === 'completed').length,
    incomplete: purchaseOrders.filter(o => o.status === 'incomplete').length,
    activeDelivery: purchaseOrders.filter(o => o.poType === 'active-delivery').length,
    discrepancy: purchaseOrders.filter(o => o.poType === 'discrepancy').length,
  });

  return {
    purchaseOrders,
    setPurchaseOrders,
    addPurchaseOrder,
    updatePurchaseOrder,
    getStats,
  };
}
