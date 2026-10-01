'use client';
import { useEffect, useState } from 'react';
import { createCatalogItem, getCatalogItems, updateCatalogItem } from '../../../actions/items';

// Purchaser/Superadmin only. Warehouse never sees this component.
export default function CatalogManager() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setError('');
    try {
      setItems(await getCatalogItems({ includeInactive: true, search: search.trim() || undefined }));
    } catch (e) {
      setError(e?.message || 'Failed to load catalog');
    }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    setError('');
    try {
      await createCatalogItem({ name, unit, category: category || undefined });
      setName(''); setCategory('');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to register item');
    }
  };

  const toggle = async (item) => {
    setError('');
    try {
      await updateCatalogItem(item.id, { active: !item.active });
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to update item');
    }
  };

  return (
    <div className="border rounded p-4 mt-6">
      <h3 className="font-bold">Item Catalog (Purchaser/Superadmin)</h3>
      <p className="text-xs text-gray-500">Free-text category for now; duplicate names blocked by normalized name.</p>
      <div className="flex gap-2 mt-2">
        <input className="border rounded px-2 py-1" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="px-2 py-1 border rounded" onClick={load}>Search</button>
      </div>
      <div className="flex gap-2 mt-2">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Item name *" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="border rounded px-2 py-1 w-24" placeholder="Unit *" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input className="border rounded px-2 py-1 flex-1" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <button className="px-3 py-1 rounded bg-[#006680] text-white" onClick={add}>Register</button>
      </div>
      {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
      <table className="w-full text-[13px] mt-3">
        <thead><tr className="text-left text-gray-500">{['Name', 'Unit', 'Category', 'Active', 'Action'].map((h) => <th key={h} className="py-1">{h}</th>)}</tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t"><td className="py-1">{it.name}</td><td className="py-1">{it.unit}</td><td className="py-1">{it.category || '—'}</td><td className="py-1">{it.active ? 'Yes' : 'No'}</td><td className="py-1"><button className="text-[#006680]" onClick={() => toggle(it)}>{it.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
