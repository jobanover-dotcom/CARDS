import React from 'react';
import { useAuth } from '../context/AuthContext';

function Reports() {
  const { user } = useAuth();

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-[#333] mb-6">Reports</h1>
      <p className="text-[#666]">Reports and analytics are coming soon...</p>
    </div>
  );
}

export default Reports;
