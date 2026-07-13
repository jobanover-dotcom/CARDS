import React from 'react';
import { createPortal } from 'react-dom';

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg" onClick={e => e.stopPropagation()}>
        {title && (
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-[#333]">{title}</h2>
            <button onClick={onClose} className="text-[#666] hover:text-[#333] text-2xl font-bold leading-none">&times;</button>
          </div>
        )}
        <div>{children}</div>
      </div>
    </div>,
    document.body
  );
}

export default Modal;
