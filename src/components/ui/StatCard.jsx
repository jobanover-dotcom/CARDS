'use client';
import React from 'react';

const colorSchemes = {
  blue: { active: 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)]', inactive: 'bg-white border-[#90caf9] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)]', count: 'text-[#1e3c72]' },
  green: { active: 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)]', inactive: 'bg-white border-[#a5d6a7] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)]', count: 'text-[#2e7d32]' },
  // Resting border is red 200, the same tint step blue (200) and green (200) use.
  // Red 500 (#f44336) sat too close to the #c62828 hover border, so a resting card
  // read as if hovered until the shadow moved.
  red: { active: 'bg-gradient-to-br from-[#fef5f5] to-[#ffcdd2] border-[#c62828] shadow-[0_4px_16px_rgba(198,40,40,0.15)]', inactive: 'bg-white border-[#ef9a9a] hover:border-[#c62828] hover:shadow-[0_4px_12px_rgba(198,40,40,0.12)]', count: 'text-[#c62828]' },
  yellow: { active: 'bg-gradient-to-br from-[#fff8e1] to-[#ffe0b2] border-[#f57f17] shadow-[0_4px_16px_rgba(245,127,23,0.15)]', inactive: 'bg-white border-[#ffb74d] hover:border-[#f57f17] hover:shadow-[0_4px_12px_rgba(245,127,23,0.12)]', count: 'text-[#f57f17]' },
  tabBlue: { active: 'bg-gradient-to-br from-[#e3f2fd] to-[#bbdefb] border-2 border-[#1e3c72] shadow-[0_4px_16px_rgba(30,60,114,0.15)]', inactive: 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#1e3c72] hover:shadow-[0_4px_12px_rgba(30,60,114,0.12)]', count: 'text-[#1e3c72]' },
  tabGreen: { active: 'bg-gradient-to-br from-[#e8f5e9] to-[#c8e6c9] border-2 border-[#2e7d32] shadow-[0_4px_16px_rgba(46,125,50,0.15)]', inactive: 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#2e7d32] hover:shadow-[0_4px_12px_rgba(46,125,50,0.12)]', count: 'text-[#2e7d32]' },
  // Neutral. "Everything", so it must never read as a state of its own.
  slate: { active: 'bg-gradient-to-br from-[#eceff1] to-[#cfd8dc] border-2 border-[#546e7a] shadow-[0_4px_16px_rgba(84,110,122,0.15)]', inactive: 'bg-white border-2 border-[#e0e0e0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#546e7a] hover:shadow-[0_4px_12px_rgba(84,110,122,0.12)]', count: 'text-[#546e7a]' },
  // Active work in flight. Distinct from red, which is reserved for exceptions.
  // Resting border is orange 200, the same tint step as the blue/red/green cards.
  // It was neutral grey, copied from `slate` below — but slate is grey on purpose
  // ("everything", so it must not read as a state) while In Progress is a real
  // bucket, and grey made it look inert next to its four siblings.
  amber: { active: 'bg-gradient-to-br from-[#fff8e1] to-[#ffecb3] border-2 border-[#f9a825] shadow-[0_4px_16px_rgba(249,168,37,0.18)]', inactive: 'bg-white border-2 border-[#ffcc80] shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-[#f9a825] hover:shadow-[0_4px_12px_rgba(249,168,37,0.14)]', count: 'text-[#f9a825]' },
};

function StatCard({ label, count, description, color = 'blue', isActive = false, onClick }) {
  const scheme = colorSchemes[color] || colorSchemes.blue;
  return (
    <div
      className={`border-2 rounded-xl p-8 text-center cursor-pointer transition-all duration-300 transform ${
        isActive
          ? `${scheme.active} scale-[1.02] -translate-y-1`
          : `${scheme.inactive} shadow-[0_2px_8px_rgba(0,0,0,0.06)]`
      }`}
      onClick={onClick}
    >
      <h3 className="m-0 text-sm font-semibold mb-3" style={{ color: isActive ? '#444' : '#666' }}>{label}</h3>
      <div className={`text-5xl font-bold ${scheme.count}`}>{count}</div>
      {description && <p className="mt-3 mx-0 mb-0 text-xs text-[#777]">{description}</p>}
    </div>
  );
}

export default StatCard;
