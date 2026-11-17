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

export function useFloodForecast(options?: UseFloodForecastOptions) {
  const [data, setData] = useState<FloodForecastContext | null>(null);
  const [status, setStatus] = useState<ForecastStatus>('INITIAL_LOADING');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isFetchingRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

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

      try {
        const result = await apiClient.getFloodForecast(
          {
            lat: options?.lat,
            lng: options?.lng,
            days: options?.days,
            forceRefresh,
          },
          abortController.signal,
        );

        // Discard response if a newer request was dispatched or component unmounted
        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        setData(result);
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
        setStatus((prev) => (prev === 'INITIAL_LOADING' ? 'ERROR' : 'STALE'));
      } finally {
        if (requestId === latestRequestIdRef.current) {
          isFetchingRef.current = false;
          activeAbortControllerRef.current = null;
        }
      }
    },
    [options?.lat, options?.lng, options?.days],
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
    status,
    error,
    lastUpdated,
    refresh: fetchForecast,
    isFresh: data?.freshness === 'FRESH' || data?.freshness === 'CACHED',
    isOfflineFixture: data?.freshness === 'OFFLINE_FIXTURE',
    isUnavailable: status === 'UNAVAILABLE' || data?.freshness === 'UNAVAILABLE',
  };
}
