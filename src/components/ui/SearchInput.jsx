'use client';
import React from 'react';

function SearchInput({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      className={`w-full max-w-[300px] py-2.5 px-4 border border-[#e0e0e0] rounded-md text-[13px] placeholder:text-[#999] focus:outline-none focus:border-[#7ec8e3] focus:ring-2 focus:ring-[#7ec8e3]/10 ${className}`}
      value={value}
      onChange={onChange}
    />
  );
}

export default SearchInput;
