'use client';
import { useEffect, useRef, useState } from 'react';
import { searchItems } from '../../../actions/items';

// Searchable autocomplete over the Item Catalog (no AI). Selecting an item
// fills the standardized name + unit. Warehouse may select but not register;
// catalog management controls must check role before rendering.
export default function ItemCombobox({ value, unit, onSelect, placeholder = 'Search catalog items…', disabled = false }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchItems(query, 20));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [query, open]);

  return (
    <div className="relative">
      <input
        className="w-full border rounded px-2 py-1"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-30 w-full bg-white border rounded shadow max-h-56 overflow-auto">
          {loading && <div className="px-2 py-1 text-xs text-gray-500">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-2 py-1 text-xs text-gray-500">No catalog match — {unit ? '' : ''}ask a purchaser to register it.</div>
          )}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full text-left px-2 py-1 hover:bg-gray-100"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(item); setQuery(item.name); setOpen(false); }}
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-gray-500"> · {item.unit}{item.category ? ` · ${item.category}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
