// Small hooks for loading data and running write actions.
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api.ts';

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'INTERNAL', err instanceof Error ? err.message : String(err));
}

export type Loaded<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => void };

// Loads data when the component appears and whenever `deps` change. `reload()` fetches it again.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true; // ignore the answer if the component moved on to other data
    setLoading(true);
    load().then(
      (result) => {
        if (!active) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        setData(null);
        setError(toApiError(err));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
    // `load` is a new function on every render, so the caller lists what it depends on.
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// Runs one write action and keeps its error or success message for an inline alert.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await action();
      if (success) setDone(typeof success === 'string' ? success : success(result));
      return result;
    } catch (err) {
      setError(toApiError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setError(null);
    setDone(null);
  }

  return { busy, error, done, run, clear, setError };
}

// ---------- Hash routing: #/agent, #/agent/REF, #/schemes, #/schemes/REF, #/review, #/rules ----------

export type Tab = 'agent' | 'schemes' | 'review' | 'rules';
export type Route = { tab: Tab; ref: string | null };

const TABS: Tab[] = ['agent', 'schemes', 'review', 'rules'];

export function parseHash(hash: string): Route {
  const [tab, ref] = hash.replace(/^#\/?/, '').split('/');
  const known = TABS.find((t) => t === tab) ?? 'agent';
  const hasRef = (known === 'agent' || known === 'schemes') && !!ref;
  return { tab: known, ref: hasRef ? decodeURIComponent(ref) : null };
}

export const hrefFor = (tab: Tab, ref?: string | null) => (ref ? `#/${tab}/${encodeURIComponent(ref)}` : `#/${tab}`);

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
