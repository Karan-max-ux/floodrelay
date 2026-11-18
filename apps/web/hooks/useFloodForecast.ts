'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FloodForecastContext } from '@floodrelay/shared';
import { apiClient } from '@/lib/api/client';

export type ForecastStatus =
  'INITIAL_LOADING' | 'READY' | 'STALE' | 'UNAVAILABLE' | 'OFFLINE_FIXTURE' | 'ERROR';

export interface UseFloodForecastOptions {
  lat?: number;
  lng?: number;
  days?: number;
  autoFetch?: boolean;
}

export interface ForecastQueryIdentity {
  lat: number;
  lng: number;
  days: number;
}

export function areQueriesEqual(a: ForecastQueryIdentity, b: ForecastQueryIdentity): boolean {
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4 && a.days === b.days;
}

export function useFloodForecast(options?: UseFloodForecastOptions) {
  const targetLat = options?.lat ?? 28.65;
  const targetLng = options?.lng ?? 77.23;
  const targetDays = options?.days ?? 7;

  const currentQuery: ForecastQueryIdentity = {
    lat: targetLat,
    lng: targetLng,
    days: targetDays,
  };

  const [data, setData] = useState<FloodForecastContext | null>(null);
  const [dataQuery, setDataQuery] = useState<ForecastQueryIdentity | null>(null);
  const [status, setStatus] = useState<ForecastStatus>('INITIAL_LOADING');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isFetchingRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<ForecastQueryIdentity>(currentQuery);
  const activeDataRef = useRef<{
    data: FloodForecastContext | null;
    query: ForecastQueryIdentity | null;
  }>({
    data: null,
    query: null,
  });

  // Keep ref updated synchronously
  activeDataRef.current = { data, query: dataQuery };

  // Explicit query identity invalidation: when location or horizon changes,
  // invalidate previous location data so Location A's data is never displayed as Location B's.
  useEffect(() => {
    if (!areQueriesEqual(lastQueryRef.current, currentQuery)) {
      lastQueryRef.current = currentQuery;
      setData(null);
      setDataQuery(null);
      setStatus('INITIAL_LOADING');
      setError(null);
    }
  }, [targetLat, targetLng, targetDays]);

  const fetchForecast = useCallback(
    async (forceRefresh = false) => {
      // Abort previous in-flight request if any to avoid race conditions
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;
      const requestId = ++latestRequestIdRef.current;
      isFetchingRef.current = true;

      const requestedQuery: ForecastQueryIdentity = {
        lat: targetLat,
        lng: targetLng,
        days: targetDays,
      };

      try {
        const result = await apiClient.getFloodForecast(
          {
            lat: targetLat,
            lng: targetLng,
            days: targetDays,
            forceRefresh,
          },
          abortController.signal,
        );

        // Discard response if a newer request was dispatched or component unmounted
        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        setData(result);
        setDataQuery(requestedQuery);
        if (result.freshness === 'UNAVAILABLE') {
          setStatus('UNAVAILABLE');
        } else if (result.freshness === 'OFFLINE_FIXTURE') {
          setStatus('OFFLINE_FIXTURE');
        } else if (result.freshness === 'STALE') {
          setStatus('STALE');
        } else {
          setStatus('READY');
        }
        setError(null);
        setLastUpdated(new Date());
      } catch (err: unknown) {
        // Discard error if request was aborted due to newer request or unmount
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        if (err instanceof Error && (err.name === 'AbortError' || abortController.signal.aborted)) {
          return;
        }

        const msg = err instanceof Error ? err.message : 'Failed to fetch flood forecast context';
        setError(msg);

        // Legitimate stale fallback ONLY if existing data belongs to the exact same query identity.
        // Never represent Location A's data as Location B's stale forecast!
        const currentActive = activeDataRef.current;
        if (
          currentActive.data &&
          currentActive.query &&
          areQueriesEqual(currentActive.query, requestedQuery)
        ) {
          setStatus('STALE');
        } else {
          setData(null);
          setDataQuery(null);
          setStatus('ERROR');
        }
      } finally {
        if (requestId === latestRequestIdRef.current) {
          isFetchingRef.current = false;
          activeAbortControllerRef.current = null;
        }
      }
    },
    [targetLat, targetLng, targetDays],
  );

  useEffect(() => {
    if (options?.autoFetch !== false) {
      fetchForecast();
    }

    return () => {
      // Invalidate in-flight and abort on unmount or deps change
      latestRequestIdRef.current++;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
    };
  }, [fetchForecast, options?.autoFetch]);

  return {
    data,
    queryIdentity: dataQuery,
    status,
    error,
    lastUpdated,
    refresh: fetchForecast,
    isFresh: data?.freshness === 'FRESH' || data?.freshness === 'CACHED',
    isOfflineFixture: data?.freshness === 'OFFLINE_FIXTURE',
    isUnavailable: status === 'UNAVAILABLE' || data?.freshness === 'UNAVAILABLE',
  };
}
