'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { getItemDescriptionSuggestions } from '../../../actions/requests';

const HISTORY_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#aaa]">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <polyline points="3 3 3 8 8 8" />
    <line x1="12" y1="7" x2="12" y2="12" />
    <line x1="12" y1="12" x2="16" y2="14" />
  </svg>
);

export default function ItemDescriptionInput({
  value,
  onChange,
  onPick,
  placeholder = 'Item description',
  inputClass = 'py-2.5 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] w-full box-border',
  required = false,
}) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef(null);
  const listId = useId();

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        setSuggestions(await getItemDescriptionSuggestions(query, 8));
        setActive(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [query, open]);

  const pick = (suggestion) => {
    setQuery(suggestion.itemDescription);
    setOpen(false);
    setActive(-1);
    onChange(suggestion.itemDescription);
    if (onPick) onPick(suggestion.itemDescription, suggestion.unit);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
  };

  return (
    <div className="relative">
      <input
        className={inputClass}
        placeholder={placeholder}
        value={query}
        required={required}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => { setOpen(false); setActive(-1); }, 150)}
      />
      {open && (loading || suggestions.length > 0) && (
        <div id={listId} role="listbox" className="absolute z-40 mt-1 w-full bg-white border border-[#ddd] rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.12)] max-h-40 overflow-auto">
          {loading && suggestions.length === 0 && <div className="px-3 py-2 text-xs text-[#888]">Loading past items…</div>}
          {suggestions.map((s, i) => (
            <button
              key={s.itemDescription}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`w-full flex items-center gap-2 text-left px-3 py-2 text-[13px] text-[#333] ${i === active ? 'bg-[#eef2f7]' : 'hover:bg-[#f5f6f8]'}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              {HISTORY_ICON}
              <span className="truncate">{s.itemDescription}</span>
              <span className="ml-auto text-[11px] text-[#999]">{s.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
