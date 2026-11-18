'use client';

import React from 'react';
import { formatRegionDateTime } from '@/lib/region';
import type {
  OperationalEvent,
  OperationalEventType,
  EventProcessingStatus,
} from '@/lib/api/types';

export interface OperationalEventCardProps {
  event: OperationalEvent;
  onSelect?: (event: OperationalEvent) => void;
  isSelected?: boolean;
}

export function OperationalEventCard({
  event,
  onSelect,
  isSelected = false,
}: OperationalEventCardProps) {
  const formatTimestamp = (iso: string): string => {
    const formatted = formatRegionDateTime(iso);
    return formatted === 'Unknown' ? iso : formatted;
  };

  const getEventTypeMeta = (
    type: OperationalEventType,
  ): { label: string; icon: string; badgeClass: string } => {
    switch (type) {
      case 'REQUEST_CREATED':
        return {
          label: 'New Request Created',
          icon: 'emergency',
          badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
        };
      case 'REQUEST_FLAGGED_DUPLICATE':
        return {
          label: 'Duplicate Flagged',
          icon: 'content_copy',
          badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        };
      case 'REQUEST_CANCELLED':
        return {
          label: 'Request Cancelled',
          icon: 'cancel',
          badgeClass: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
        };
      case 'RESOURCE_OFFLINE':
        return {
          label: 'Resource Offline',
          icon: 'warning',
          badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
        };
      case 'RESOURCE_AVAILABLE':
        return {
          label: 'Resource Available',
          icon: 'check_circle',
          badgeClass:
            'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
        };
      case 'ROAD_BLOCKED':
        return {
          label: 'Road Hazard Blocked',
          icon: 'block',
          badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
        };
      case 'ROAD_REOPENED':
        return {
          label: 'Road Hazard Cleared',
          icon: 'lock_open',
          badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
        };
      default:
        return {
          label: type,
          icon: 'info',
          badgeClass: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
        };
    }
  };

  const getStatusBadge = (status?: EventProcessingStatus) => {
    switch (status) {
      case 'RECORDED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            RECORDED
          </span>
        );
      case 'SCOPE_IDENTIFIED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            SCOPE IDENTIFIED
          </span>
        );
      case 'AWAITING_REPAIR':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            AWAITING REPAIR
          </span>
        );
      case 'FAILED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
            FAILED
          </span>
        );
      default:
        return null;
    }
  };

  const meta = getEventTypeMeta(event.type);

  // Generate readable summary preview from payload
  const renderSummary = () => {
    const payload = event.payload || {};
    if (event.type === 'RESOURCE_OFFLINE' || event.type === 'RESOURCE_AVAILABLE') {
      const prev = payload.previousStatus || 'UNKNOWN';
      const next = payload.newStatus || 'UNKNOWN';
      const reason = payload.reason ? ` (${payload.reason})` : '';
      return `Status changed: ${prev} → ${next}${reason}`;
    }
    if (event.type === 'ROAD_BLOCKED' || event.type === 'ROAD_REOPENED') {
      const name = payload.name || event.entityId;
      const severity = payload.severity ? ` [${payload.severity}]` : '';
      return `${name}${severity}`;
    }
    if (event.type === 'REQUEST_CREATED') {
      const people = payload.peopleCount ? `${payload.peopleCount} passengers` : '';
      const urgency = payload.urgency ? `Priority: ${payload.urgency}` : '';
      return [people, urgency].filter(Boolean).join(' • ') || `Target: ${event.entityId}`;
    }
    if (event.type === 'REQUEST_FLAGGED_DUPLICATE') {
      const orig = payload.duplicateOfId
        ? `Duplicate of ${payload.duplicateOfId}`
        : 'Spatial match';
      return orig;
    }
    return `Entity ${event.entityType}: ${event.entityId}`;
  };

  return (
    <div
      className={`p-4 rounded-xl border transition-all text-left bg-surface-container-lowest ${
        isSelected
          ? 'border-primary ring-2 ring-primary/20 shadow-sm'
          : 'border-outline-variant hover:border-outline hover:shadow-xs'
      }`}
      data-testid={`event-card-${event.id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className={`p-1.5 rounded-lg flex items-center justify-center ${meta.badgeClass}`}>
            <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
          </span>
          <div>
            <span className="text-sm font-bold text-on-surface block leading-tight">
              {meta.label}
            </span>
            <span className="text-[11px] font-mono text-on-surface-variant">ID: {event.id}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {getStatusBadge(event.processingStatus)}
          <span className="text-[10px] font-mono text-on-surface-variant">
            {formatTimestamp(event.recordedAt || event.occurredAt)}
          </span>
        </div>
      </div>

      <p className="text-xs text-on-surface mb-3 line-clamp-2">{renderSummary()}</p>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/15 text-[11px] font-mono text-on-surface-variant">
        <div className="flex items-center gap-2">
          <span className="bg-surface-container px-2 py-0.5 rounded font-bold text-on-surface">
            {event.entityType}: {event.entityId}
          </span>
          <span>Actor: {event.actorType}</span>
        </div>

        {onSelect && (
          <button
            className="text-primary hover:underline font-semibold flex items-center gap-0.5"
            onClick={() => onSelect(event)}
            type="button"
          >
            <span>View Impact</span>
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </button>
        )}
      </div>
    </div>
  );
}
