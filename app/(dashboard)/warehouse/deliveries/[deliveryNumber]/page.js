import Link from 'next/link';

// Warehouse has no access to the delivery archive. Receiving is recorded
// against the purchase order, not against a delivery record, so there is
// nothing for a warehouse user to open here.
export default function Page() {
  return (
    <div className="bg-white rounded-lg p-6">
      <h1 className="m-0 text-xl font-bold text-[#333]">No delivery record</h1>
      <p className="mt-2 text-sm text-[#666]">
        CARDS does not create delivery records. The supplier delivers outside the system, and you record
        what actually arrived on the Purchase Orders screen.
      </p>
      <p className="mt-4 text-sm">
        <Link className="text-[#006680] font-semibold" href="/warehouse">&larr; Back to Purchase Orders</Link>
      </p>
    </div>
  );
}
