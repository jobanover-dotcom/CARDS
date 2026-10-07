'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 10;

export function useInfiniteRows(fetcher, params = {}, version = 0) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const offsetRef = useRef(0);
  const fetchIdRef = useRef(0);
  const paramsKey = JSON.stringify(params ?? {});

  // A mirror of `rows`, readable from inside `load` without making the row list a
  // dependency of it. Two things need it before the next fetch resolves: whether
  // there is anything on screen to keep, and how deep the list is.
  //
  // It is assigned synchronously rather than inside a `setRows` updater, because a
  // state updater does not run until React renders — a ref read in the same tick
  // would still see the previous page.
  const rowsRef = useRef([]);
  const commitRows = useCallback((next) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const load = useCallback(
    async ({ replace, showSkeleton }) => {
      const fetchId = ++fetchIdRef.current;
      if (replace) {
        offsetRef.current = 0;
        // Two different fetches, and they must not look alike on screen.
        //
        // A FILTER OR SEARCH change (`showSkeleton`) is the reader asking a new
        // question. The rows on screen answer the previous one, so they are
        // replaced by placeholders while the new answer is in flight.
        //
        // A MUTATION — a delete, an approval, a save — is the reader acting on
        // what is already on screen. What is visible stays true, so it stays put
        // and is refreshed behind. Blanking it would hide the very button they
        // had just pressed.
        setInitialLoading(Boolean(showSkeleton) || rowsRef.current.length === 0);
        setRefreshing(true);
      } else {
        setLoadingMore(true);
      }
      try {
        // A `replace` refetch restarts from offset 0, so it must ask for at least
        // as many rows as are already on screen — otherwise deleting at row 30
        // hands the reader a 10-row table with nothing to explain it. A
        // `loadMore` already positions itself past the loaded rows, so it stays
        // at one page.
        const limit = replace ? Math.max(PAGE_SIZE, rowsRef.current.length) : PAGE_SIZE;
        const result = await fetcher({ ...(params ?? {}), offset: offsetRef.current, limit });
        if (fetchId !== fetchIdRef.current) return;
        setTotal(result.total ?? result.rows.length);
        commitRows(replace ? result.rows : [...rowsRef.current, ...result.rows]);
        offsetRef.current += result.rows.length;
        setError(null);
      } catch (e) {
        if (fetchId === fetchIdRef.current) setError(e.message || 'Failed to load data');
      } finally {
        if (fetchId === fetchIdRef.current) {
          setInitialLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [fetcher, params, commitRows],
  );

  // Fetch-on-params-change is this hook's contract: deps are keyed on the
  // serialized paramsKey/version (caller param objects are re-created each
  // render, so fetcher/params identity is not a stable signal).
  //
  // `paramsKey` and `version` both trigger a fetch but mean different things, so
  // the effect records which one moved and tells `load` whether to show a
  // skeleton. A version bump with identical params is a mutation, and must not
  // blank the table.
  //
  // TanStack Query is the long-term replacement (see playbooks/).
  /* eslint-disable react-hooks/exhaustive-deps -- fetch effect by design */
  const previousParamsKey = useRef(paramsKey);
  useEffect(() => {
    const filterChanged = previousParamsKey.current !== paramsKey;
    previousParamsKey.current = paramsKey;
    load({ replace: true, showSkeleton: filterChanged });
  }, [paramsKey, version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const loadMore = useCallback(() => {
    if (!initialLoading && !loadingMore && rows.length < total) {
      load({ replace: false });
    }
  }, [load, initialLoading, loadingMore, rows.length, total]);

  return { rows, total, initialLoading, refreshing, loadingMore, error, hasMore: rows.length < total, loadMore };
}

export default useInfiniteRows;
