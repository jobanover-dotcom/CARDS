import React from 'react';

// One empty state for every table. Still a <tr>: rendering it outside a <tbody>
// makes the client DOM parser relocate it and breaks hydration, so callers keep
// their <tbody> local (see src/lib/__tests__/reports.test.ts).
//
// `hint` is the second half of the message — what to do next. Callers pass it
// when a search or filter is what emptied the table, because "no rows" and "no
// rows match what you typed" are different answers and only one of them is the
// user's problem.
function EmptyState({ colSpan, message = 'No data found', hint = null }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center align-top">
        <p className="m-0 text-[13px] text-[#666]">{message}</p>
        {hint && <p className="mt-1 mb-0 text-[12px] text-[#999]">{hint}</p>}
      </td>
    </tr>
  );
}

export default EmptyState;