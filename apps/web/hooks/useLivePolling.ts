'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ApiClientError, isAbortError } from '@/lib/api/errors';

export type LivePollingStatus =
  | 'INITIAL_LOADING'
  | 'UP_TO_DATE'
  | 'REFRESHING'
  | 'STALE'
  | 'OFFLINE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN';

export interface UseLivePollingOptions<T> {
  intervalMs?: number;
  enabled?: boolean;
  pauseWhenHidden?: boolean;
  maxBackoffMs?: number;
  initialData?: T;
  staleMultiplier?: number;
  onError?: (err: Error) => void;
  onSuccess?: (data: T) => void;
}

export interface UseLivePollingResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  status: LivePollingStatus;
  lastUpdated: Date | null;
  error: Error | null;
  refresh: () => Promise<void>;
  statusLabel: string;
}

const DEFAULT_INTERVAL_MS = 20000; // 20 seconds default
const DEFAULT_MAX_BACKOFF_MS = 60000; // 60 seconds max backoff

export function useLivePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseLivePollingOptions<T> = {},
): UseLivePollingResult<T> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
    pauseWhenHidden = true,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    initialData,
    onError,
    onSuccess,
  } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [status, setStatus] = useState<LivePollingStatus>(
    initialData !== undefined ? 'UP_TO_DATE' : 'INITIAL_LOADING',
  );
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialData !== undefined ? new Date() : null,
  );

  // Keep latest mutable references
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const optionsRef = useRef({ intervalMs, enabled, pauseWhenHidden, maxBackoffMs });
  optionsRef.current = { intervalMs, enabled, pauseWhenHidden, maxBackoffMs };

  const statusRef = useRef<LivePollingStatus>(status);
  statusRef.current = status;

  const dataRef = useRef<T | undefined>(data);
  dataRef.current = data;

  const isMountedRef = useRef<boolean>(true);
  const isPollingRef = useRef<boolean>(false);
  const seqRef = useRef<number>(0);
  const backoffDelayRef = useRef<number>(intervalMs);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  const abortInFlight = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  // Stable execution function that does NOT recreate on status change
  const executePoll = useCallback(
    async (isManual = false): Promise<void> => {
      if (!optionsRef.current.enabled || !isMountedRef.current) return;

      // Prevent overlapping duplicate polls
      if (isPollingRef.current && !isManual) {
        return;
      }

      // If manual refresh, cancel any pending timer and in-flight request to prioritize manual fetch
      if (isManual) {
        clearTimer();
        abortInFlight();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isPollingRef.current = true;
      const currentSeq = ++seqRef.current;

      const hasExistingData = dataRef.current !== undefined;
      const nextStatus: LivePollingStatus = hasExistingData ? 'REFRESHING' : 'INITIAL_LOADING';
      statusRef.current = nextStatus;
      setStatus(nextStatus);

      try {
        const result = await fetcherRef.current(controller.signal);

        // Ignore if unmounted or if a newer poll has superseded this one
        if (!isMountedRef.current || currentSeq !== seqRef.current) {
          return;
        }

        setData(result);
        dataRef.current = result;
        const now = new Date();
        setLastUpdated(now);
        setError(null);
        statusRef.current = 'UP_TO_DATE';
        setStatus('UP_TO_DATE');
        backoffDelayRef.current = optionsRef.current.intervalMs; // Reset backoff on success
        onSuccessRef.current?.(result);
      } catch (err: unknown) {
        if (!isMountedRef.current || currentSeq !== seqRef.current) {
          return;
        }

        // Ignore intentional aborts on unmount or cancellation
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        onErrorRef.current?.(errorObj);

        // Check for auth / permission errors (401/403 terminates polling)
        if (err instanceof ApiClientError) {
          if (err.statusCode === 401) {
            statusRef.current = 'UNAUTHORIZED';
            setStatus('UNAUTHORIZED');
            return;
          }
          if (err.statusCode === 403) {
            statusRef.current = 'FORBIDDEN';
            setStatus('FORBIDDEN');
            return;
          }
          if (err.isNetworkError) {
            statusRef.current = 'OFFLINE';
            setStatus('OFFLINE');
          } else {
            statusRef.current = 'STALE';
            setStatus('STALE');
          }
        } else {
          statusRef.current = 'STALE';
          setStatus('STALE');
        }

        // Bounded exponential backoff on failure
        backoffDelayRef.current = Math.min(
          backoffDelayRef.current * 1.5,
          optionsRef.current.maxBackoffMs,
        );
      } finally {
        // Only the active/latest polling execution manages lifecycle state and scheduling.
        // Prevents cancelled, unmounted, or superseded polls from resetting refs or double-scheduling timers.
        if (currentSeq === seqRef.current) {
          isPollingRef.current = false;
          abortControllerRef.current = null;

          // Schedule next polling cycle if still mounted, enabled, and not terminated by auth failure
          if (
            isMountedRef.current &&
            optionsRef.current.enabled &&
            statusRef.current !== 'UNAUTHORIZED' &&
            statusRef.current !== 'FORBIDDEN'
          ) {
            const isHidden = typeof document !== 'undefined' && document.hidden;
            if (!optionsRef.current.pauseWhenHidden || !isHidden) {
              clearTimer();
              const delay = isManual ? optionsRef.current.intervalMs : backoffDelayRef.current;
              timeoutIdRef.current = setTimeout(() => {
                void executePoll(false);
              }, delay);
            }
          }
        }
      }
    },
    [clearTimer, abortInFlight],
  );

  // Manual refresh trigger
  const refresh = useCallback(async (): Promise<void> => {
    backoffDelayRef.current = optionsRef.current.intervalMs;
    await executePoll(true);
  }, [executePoll]);

  // Primary lifecycle effect: controlled solely by `enabled` and initial mount
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      clearTimer();
      abortInFlight();
      return;
    }

    void executePoll(false);

    return () => {
      isMountedRef.current = false;
      clearTimer();
      abortInFlight();
    };
  }, [enabled, executePoll, clearTimer, abortInFlight]);

  // Handle visibility changes (pause when hidden, resume & refresh once on visible)
  useEffect(() => {
    if (typeof document === 'undefined' || !pauseWhenHidden) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: cancel upcoming timer to pause polling
        clearTimer();
      } else {
        // Tab visible again: refresh once immediately if not already polling
        if (!isPollingRef.current && enabled) {
          void executePoll(false);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, executePoll, clearTimer, pauseWhenHidden]);

  // Derived user-facing label
  const statusLabel = (() => {
    switch (status) {
      case 'INITIAL_LOADING':
        return 'Connecting to command center...';
      case 'REFRESHING':
        return 'Refreshing live operations...';
      case 'UP_TO_DATE':
        return 'Live updates active';
      case 'STALE':
        return 'Data may be outdated (retrying...)';
      case 'OFFLINE':
        return 'Connection lost — displaying last verified data';
      case 'UNAUTHORIZED':
        return 'Session expired — re-authentication required';
      case 'FORBIDDEN':
        return 'Access restricted — insufficient role permission';
    }
  })();

  return {
    data,
    isLoading: status === 'INITIAL_LOADING',
    isRefreshing: status === 'REFRESHING',
    status,
    lastUpdated,
    error,
    refresh,
    statusLabel,
  };
}
