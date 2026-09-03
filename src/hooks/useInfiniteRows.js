'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 10;

export function useInfiniteRows(fetcher, params = {}, version = 0) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const offsetRef = useRef(0);
  const fetchIdRef = useRef(0);
  const paramsKey = JSON.stringify(params ?? {});

  const load = useCallback(
    async ({ replace }) => {
      const fetchId = ++fetchIdRef.current;
      if (replace) {
        offsetRef.current = 0;
        setInitialLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const result = await fetcher({ ...(params ?? {}), offset: offsetRef.current, limit: PAGE_SIZE });
        if (fetchId !== fetchIdRef.current) return;
        setTotal(result.total ?? result.rows.length);
        setRows((prev) => (replace ? result.rows : [...prev, ...result.rows]));
        offsetRef.current += result.rows.length;
        setError(null);
      } catch (e) {
        if (fetchId === fetchIdRef.current) setError(e.message || 'Failed to load data');
      } finally {
        if (fetchId === fetchIdRef.current) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [fetcher, params]
  );

  // Fetch-on-params-change is this hook's contract: deps are keyed on the
  // serialized paramsKey/version (caller param objects are re-created each
  // render, so fetcher/params identity is not a stable signal).
  // TanStack Query is the long-term replacement (see playbooks/).
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- fetch effect by design */
  useEffect(() => {
    load({ replace: true });
  }, [paramsKey, version]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  const loadMore = useCallback(() => {
    if (!initialLoading && !loadingMore && rows.length < total) {
      load({ replace: false });
    }
  }, [load, initialLoading, loadingMore, rows.length, total]);

  return { rows, total, initialLoading, loadingMore, error, hasMore: rows.length < total, loadMore };
}

export default useInfiniteRows;
