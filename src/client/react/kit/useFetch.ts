import { useEffect, useState } from 'react';

export type Fetch<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: T };

/** Fetch once on mount; ignores results after unmount. */
export function useFetch<T>(fetcher: () => Promise<T>): Fetch<T> {
  const [state, setState] = useState<Fetch<T>>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((data) => {
        if (alive) setState({ kind: 'ready', data });
      })
      .catch(() => {
        if (alive) setState({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
    // fetch once on mount by design (deps intentionally empty)
  }, []);
  return state;
}
