'use client';
import React from 'react';

// A small segmented control for switching between two presentations of the same
// data.
//
// Built from tokens the app already uses rather than a new design language: the
// active face is the same `bg-[#1e3c72] text-white` the sidebar uses for the
// current page, and the container is the same `rounded-md` + border +
// `transition-all duration-300` the rest of CARDS uses.
//
// Real <button> elements, not a clickable <div> like StatCard: a view switch is
// operable with Tab, Enter and Space, and exposes its state to assistive tech via
// aria-pressed rather than relying on colour alone.

function SegmentedControl({ label, options, value, onChange, className = '' }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center gap-1 p-1 bg-gray-100 border border-[#e0e0e0] rounded-md ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            title={option.title || undefined}
            className={`px-3 py-1.5 text-[12px] font-semibold rounded no-underline transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3c72] focus-visible:ring-offset-1 ${
              active
                ? 'bg-[#1e3c72] text-white'
                : 'bg-transparent text-[#666] hover:bg-white hover:text-[#1e3c72]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;