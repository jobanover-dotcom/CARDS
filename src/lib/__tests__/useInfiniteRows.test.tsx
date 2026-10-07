import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInfiniteRows } from '@/hooks/useInfiniteRows';

// A paginated table triggers a fetch for two unrelated reasons, and the two must
// not look alike on screen.
//
//   FILTER or SEARCH  the reader asks a new question. The rows on screen answer
//                     the previous one, so placeholders stand in while the new
//                     answer is in flight.
//   MUTATION          the reader acts on what is already there — a delete, an
//                     approval, a save. What is visible is still true, so it
//                     stays put and refreshes behind. Blanking it would hide the
//                     very button they had just pressed.
//
// Every `replace` load used to set `initialLoading`, which is what views branch on
// to choose between a skeleton and the real table. That made a delete flash a
// full skeleton over readable rows; treating every refetch as a mutation later
// removed the feedback from filtering instead. These tests pin both halves from
// opposite directions, plus the paging behaviour neither should disturb.

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

  it('shows the skeleton across a filter change, because the rows answer a different question', async () => {
    let page = rows(5, 'unfiltered');
    // The second fetch is held open so the mid-flight state is observable.
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length > 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { rows: page, total: 5 };
    });
    const { result, rerender } = renderHook(({ status }) => useInfiniteRows(fetcher, { status }, 0), {
      initialProps: { status: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(result.current.initialLoading).toBe(false);

    // The reader taps a filter. The rows on screen were the answer to the
    // PREVIOUS question, so they must not stand in for this one.
    page = rows(2, 'rejected');
    await act(async () => {
      rerender({ status: 'Rejected' });
      await Promise.resolve();
    });
    await waitFor(() => expect(release).not.toBeNull());

    expect(result.current.initialLoading).toBe(true);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      release!();
    });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].id).toBe('rejected-0');
  })

  it('does not re-show the skeleton when a version bump lands on the same params', async () => {
    // The other half of the split. A delete is the reader acting on what is
    // already on screen, so the table must stay put — this is the case the
    // sibling test above covers, and the two must not drift together.
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length > 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { rows: rows(4, 'first'), total: 4 };
    });
    const { result, rerender } = renderHook(
      ({ status, v }) => useInfiniteRows(fetcher, { status }, v),
      { initialProps: { status: 'Pending', v: 0 } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    await act(async () => {
      rerender({ status: 'Pending', v: 1 });
      await Promise.resolve();
    });
    await waitFor(() => expect(release).not.toBeNull());

    // Params identical, so this is a mutation: no skeleton, rows untouched.
    expect(result.current.initialLoading).toBe(false);

    await act(async () => {
      release!();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  })

  it('treats a search term as a filter change', async () => {
    // Search travels through `params` exactly as a filter does, so it earns the
    // skeleton on the same terms.
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length > 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { rows: rows(3, 'page'), total: 3 };
    });
    const { result, rerender } = renderHook(
      ({ search, v }) => useInfiniteRows(fetcher, { search }, v),
      { initialProps: { search: undefined as string | undefined, v: 0 } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    await act(async () => {
      rerender({ search: 'cement', v: 0 });
      await Promise.resolve();
    });
    await waitFor(() => expect(release).not.toBeNull());

    expect(result.current.initialLoading).toBe(true);
    await act(async () => {
      release!();
    });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
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