'use client';
import React from 'react';

const colorSchemes = {
  red: { active: 'bg-gradient-to-br from-[#fef5f5] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)]', inactive: 'bg-white border-[#f44336] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)]', count: 'text-[#c62828]' },
  yellow: { active: 'bg-gradient-to-br from-[#fff8e1] to-[#ffe0b2] border-[#f57f17] shadow-[0_4px_16px_rgba(245,127,23,0.15)]', inactive: 'bg-white border-[#ffb74d] hover:border-[#f57f17] hover:shadow-[0_4px_12px_rgba(245,127,23,0.12)]', count: 'text-[#f57f17]' },
};

function StackedStatCard({ topLabel, topCount, topColor = 'red', topIsActive = false, topOnClick, bottomLabel, bottomCount, bottomColor = 'yellow', bottomIsActive = false, bottomOnClick }) {
  const topScheme = colorSchemes[topColor];
  const bottomScheme = colorSchemes[bottomColor];
  const isAnyActive = topIsActive || bottomIsActive;

  return (
    <div className={`border-2 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 transform ${isAnyActive ? 'scale-[1.02] -translate-y-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)]' : 'shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`}>
      <div
        className={`p-5 text-center transition-all duration-300 border-b border-gray-200 ${topIsActive ? topScheme.active : topScheme.inactive}`}
        onClick={topOnClick}
      >
        <h3 className="m-0 text-sm font-semibold mb-2" style={{ color: topIsActive ? '#444' : '#666' }}>{topLabel}</h3>
        <div className={`text-4xl font-bold ${topScheme.count}`}>{topCount}</div>
      </div>
      <div
        className={`p-5 text-center transition-all duration-300 ${bottomIsActive ? bottomScheme.active : bottomScheme.inactive}`}
        onClick={bottomOnClick}
      >
        <h3 className="m-0 text-sm font-semibold mb-2" style={{ color: bottomIsActive ? '#444' : '#666' }}>{bottomLabel}</h3>
        <div className={`text-4xl font-bold ${bottomScheme.count}`}>{bottomCount}</div>
      </div>
    </div>
  );
}

export default StackedStatCard;
