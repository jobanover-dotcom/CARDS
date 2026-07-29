import React from 'react';

const variants = {
  primary: 'bg-gradient-to-br from-[#1e3c72] to-[#2a5298] text-white hover:-translate-y-0.5 hover:shadow-[0_10px_25px_rgba(42,82,152,0.3)]',
  secondary: 'bg-white text-[#0288d1] border-2 border-[#7ec8e3] hover:bg-[#f0f8fc] hover:border-[#0288d1]',
  success: 'bg-[#2e7d32] text-white hover:bg-[#1b5e20]',
  danger: 'bg-white text-[#d32f2f] border border-[#d32f2f] hover:bg-[#fff5f5]',
  ghost: 'bg-transparent text-[#555] hover:bg-[#7ec8e3]/20',
  logout: 'flex items-center gap-3 py-3 px-4 bg-transparent border-none rounded-md cursor-pointer text-[#d32f2f] text-sm font-semibold transition-all duration-300 hover:bg-[#d32f2f]/10',
};

function Button({ children, variant = 'primary', className = '', onClick, type = 'button', disabled = false, ...props }) {
  const base = 'py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-300 inline-flex items-center gap-2 active:translate-y-0 border-none';
  const variantClass = variants[variant] || variants.primary;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
