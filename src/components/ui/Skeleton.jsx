import React from 'react';

function Skeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden bg-[#e5e7eb]/70 rounded ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

export default Skeleton;
