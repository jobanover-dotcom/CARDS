import React from 'react';

function EmptyState({ colSpan, message = 'No data found' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center text-[#999]">
        {message}
      </td>
    </tr>
  );
}

export default EmptyState;
