import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInfiniteRows } from '@/hooks/useInfiniteRows';

// A paginated table has two different kinds of fetch, and the old hook treated
// them as one. Every `replace` load set `initialLoading`, which is what views
// branch on to decide between a skeleton and the real table. So a mutation —
// approve, decline, delete, anything that bumps a version counter — flashed a
// full skeleton over rows that were still perfectly readable, and hid the very
// button the reader had just pressed.
//
// These tests pin the distinction: a skeleton only while there is genuinely
// nothing to show, and a refetch that replaces from offset 0 must not truncate a
// list the reader has already scrolled through.

function rows(n: number, prefix = 'r') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
}

describe('useInfiniteRows', () => {
  it('shows the initial skeleton only until the first page arrives', async () => {
    const fetcher = vi.fn().mockResolvedValue({ rows: rows(3), total: 3 });
    const { result } = renderHook(() => useInfiniteRows(fetcher, {}, 0));

    // Nothing on screen yet: placeholders are the only honest thing to render.
    expect(result.current.initialLoading).toBe(true);

    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(result.current.rows).toHaveLength(3);
  });

  it('keeps existing rows visible when a version bump refetches', async () => {
    // The second fetch is held open so the mid-flight state can be observed.
    // Asserting it synchronously after rerender would race the resolution.
    let page = rows(4, 'first');
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length > 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { rows: page, total: 8 };
    });

    const { result, rerender } = renderHook(({ v }) => useInfiniteRows(fetcher, {}, v), {
      initialProps: { v: 0 },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    page = rows(4, 'second');
    // A delete lands: the server now returns different rows under the same query.
    rerender({ v: 1 });
    await waitFor(() => expect(release).not.toBeNull());

    // The regression this fixes: with rows on screen, a refetch must NOT fall back
    // to the skeleton, and must not blank the rows that are still readable.
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.rows).toHaveLength(4);
    expect(result.current.rows[0].id).toBe('first-0');

    await act(async () => {
      release!();
    });
    await waitFor(() => expect(result.current.rows[0].id).toBe('second-0'));
    expect(result.current.refreshing).toBe(false);
  })

  it('requests at least as many rows as are already loaded, so a refetch cannot truncate the list', async () => {
    const fetcher = vi.fn(async ({ limit }) => ({ rows: rows(Math.min(limit, 30)), total: 30 }));
    const { result, rerender } = renderHook(({ v }) => useInfiniteRows(fetcher, {}, v), {
      initialProps: { v: 0 },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(10));

    // Scroll to 30 rows, the way the sentinel does.
    await act(async () => {
      result.current.loadMore();
    });
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(30));

    await act(async () => {
      rerender({ v: 1 });
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    // A `replace` refetch goes back to offset 0, so a fixed page size would hand
    // the reader a 10-row table after they had scrolled to 30.
    expect(result.current.rows).toHaveLength(30);
  })

  it('keeps rows visible across a filter change rather than blanking the table', async () => {
    let page = rows(5, 'unfiltered');
    const fetcher = vi.fn(async () => ({ rows: page, total: 5 }));
    const { result, rerender } = renderHook(({ status }) => useInfiniteRows(fetcher, { status }, 0), {
      initialProps: { status: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(5));

    page = rows(2, 'rejected');
    await act(async () => {
      rerender({ status: 'Rejected' });
      await Promise.resolve();
    });

    expect(result.current.initialLoading).toBe(false);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows[0].id).toBe('rejected-0');
  })

  it('appends rather than replaces when loading more', async () => {
    // The last page is short, the way a real paged query returns it.
    const TOTAL = 25;
    const fetcher = vi.fn(async ({ offset, limit }) => ({
      rows: rows(Math.max(0, Math.min(limit, TOTAL - offset)), `p${offset}`),
      total: TOTAL,
    }));
    const { result } = renderHook(() => useInfiniteRows(fetcher, {}, 0));
    await waitFor(() => expect(result.current.rows).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(20));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(25));
    expect(result.current.hasMore).toBe(false);
    // Order is preserved across pages.
    expect(result.current.rows[10].id).toBe('p10-0');
  })

  it('surfaces a fetch failure and stays usable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useInfiniteRows(fetcher, {}, 0));

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(false);
  })
})