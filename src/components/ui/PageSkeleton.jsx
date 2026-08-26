import React from 'react';
import Skeleton from './Skeleton';

function PageSkeleton({ statCards = 3 }) {
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <Skeleton className="h-8 w-48 mb-3" />
        <Skeleton className="h-4 w-72" />
      </div>
      {statCards > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] max-md:grid-cols-1 gap-5 mb-8">
          {Array.from({ length: statCards }).map((_, i) => (
            <div key={i} className="border border-[#e0e0e0] rounded-xl p-8 bg-white">
              <Skeleton className="h-4 w-24 mb-4" />
              <Skeleton className="h-10 w-16" />
            </div>
          ))}
        </div>
      )}
      <div className="border border-[#e0e0e0] rounded-lg overflow-hidden mt-8">
        <div className="p-4 border-b border-gray-200 bg-gray-50/60 flex gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28 ml-auto" />
        </div>
        <div className="divide-y divide-gray-100">
          {[92, 78, 85, 70, 88, 76, 82].map((w, i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-5">
              <div className="h-4 w-20 rounded bg-[#e5e7eb]/50 relative overflow-hidden flex-none">
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              </div>
              <div className="h-4 rounded bg-[#e5e7eb]/50 relative overflow-hidden flex-1 max-w-[60%]" style={{ width: `${w}%` }}>
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PageSkeleton;
