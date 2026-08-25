import React, { useRef, useEffect } from 'react';

function TableScrollSentinel({ colSpan = 1, onLoadMore, isLoadingMore = false, disabled = false, skeletonRows = 2 }) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || disabled || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { rootMargin: '100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, disabled, isLoadingMore]);

  return (
    <>
      <tr ref={sentinelRef} className="pointer-events-none" aria-hidden="true">
        <td colSpan={colSpan} className="p-0 border-0 h-1" />
      </tr>
      {isLoadingMore &&
        Array.from({ length: skeletonRows }).map((_, i) => (
          <tr key={`sk-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
            <td colSpan={colSpan} className="p-4">
              <div className="flex items-center gap-6">
                {[15, 40, 25, 55].map((w, j) => (
                  <div
                    key={j}
                    className="h-4 rounded bg-[#e5e7eb]/70 relative overflow-hidden flex-none"
                    style={{ width: `${w}%`, maxWidth: `${w}%` }}
                  >
                    <div
                      className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent"
                      style={{ animationDelay: `${j * 120}ms` }}
                    />
                  </div>
                ))}
              </div>
            </td>
          </tr>
        ))}
    </>
  );
}

export default TableScrollSentinel;
