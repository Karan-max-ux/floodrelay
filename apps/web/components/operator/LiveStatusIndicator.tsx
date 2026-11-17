'use client';

import { formatRegionTime } from '@/lib/region';
import React from 'react';
import type { LivePollingStatus } from '@/hooks/useLivePolling';

export interface LiveStatusIndicatorProps {
  status: LivePollingStatus;
  lastUpdated: Date | null;
  onRefresh: () => void | Promise<void>;
  isRefreshing?: boolean;
  className?: string;
}

export function LiveStatusIndicator({
  status,
  lastUpdated,
  onRefresh,
  isRefreshing = false,
  className = '',
}: LiveStatusIndicatorProps) {
  const formatTime = (date: Date | null): string => {
    if (!date) return 'Not yet updated';
    return formatRegionTime(date, true);
  };

  const getStatusColor = (): { dot: string; text: string; bg: string } => {
    switch (status) {
      case 'UP_TO_DATE':
        return {
          dot: 'bg-emerald-500',
          text: 'text-emerald-700 dark:text-emerald-400',
          bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40',
        };
      case 'REFRESHING':
        return {
          dot: 'bg-blue-500 animate-pulse',
          text: 'text-blue-700 dark:text-blue-400',
          bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/40',
        };
      case 'STALE':
        return {
          dot: 'bg-amber-500',
          text: 'text-amber-700 dark:text-amber-400',
          bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40',
        };
      case 'OFFLINE':
        return {
          dot: 'bg-rose-500',
          text: 'text-rose-700 dark:text-rose-400',
          bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/40',
        };
      case 'UNAUTHORIZED':
      case 'FORBIDDEN':
        return {
          dot: 'bg-purple-500',
          text: 'text-purple-700 dark:text-purple-400',
          bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/40',
        };
      case 'INITIAL_LOADING':
      default:
        return {
          dot: 'bg-slate-400 animate-pulse',
          text: 'text-slate-600 dark:text-slate-400',
          bg: 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800/40',
        };
    }
  };

  const colors = getStatusColor();

  const getStatusMessage = (): string => {
    switch (status) {
      case 'UP_TO_DATE':
        return 'Live updates enabled (polling)';
      case 'REFRESHING':
        return 'Refreshing live operations...';
      case 'STALE':
        return 'Data may be outdated';
      case 'OFFLINE':
        return 'Connection lost — showing last known data';
      case 'UNAUTHORIZED':
        return 'Session expired — re-login required';
      case 'FORBIDDEN':
        return 'Access restricted';
      case 'INITIAL_LOADING':
      default:
        return 'Connecting...';
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 rounded-lg border text-xs font-medium ${colors.bg} ${className}`}
      data-testid="live-status-strip"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {status === 'UP_TO_DATE' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${colors.dot}`} />
        </span>
        <span className={`font-semibold ${colors.text}`}>{getStatusMessage()}</span>
        <span className="text-on-surface-variant/60 hidden sm:inline">•</span>
        <span className="text-on-surface-variant font-mono text-[11px] hidden sm:inline">
          Last updated: {formatTime(lastUpdated)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-on-surface-variant font-mono text-[11px] sm:hidden">
          {formatTime(lastUpdated)}
        </span>
        <button
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-outline-variant hover:bg-surface-variant text-on-surface font-semibold text-[11px] transition-colors disabled:opacity-50"
          disabled={isRefreshing || status === 'REFRESHING'}
          onClick={() => void onRefresh()}
          type="button"
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              isRefreshing || status === 'REFRESHING' ? 'animate-spin' : ''
            }`}
          >
            refresh
          </span>
          <span>Refresh Now</span>
        </button>
      </div>
    </div>
  );
}
