'use client';

import { formatRegionDate, formatRegionTime } from '@/lib/region';
import React, { useState, useMemo } from 'react';
import { useLiveAuditEvents } from '@/hooks/useLiveAuditEvents';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { LiveStatusIndicator } from '@/components/operator/LiveStatusIndicator';
import type { AuditEventRecord, ListAuditEventsFilter } from '@/lib/api/types';

export default function OperatorAuditPage() {
  const { operator } = useOperatorAuth();
  const isOperatorRole = operator?.role === 'OPERATOR';

  // Filters state
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [actorFilter, setActorFilter] = useState<string>('');
  const [entityIdSearch, setEntityIdSearch] = useState<string>('');

  // Selected event for detail modal
  const [selectedAudit, setSelectedAudit] = useState<AuditEventRecord | null>(null);

  // Memoized query filter
  const queryFilters: ListAuditEventsFilter = useMemo(() => {
    const f: ListAuditEventsFilter = { limit: 100 };
    if (entityTypeFilter) f.entityType = entityTypeFilter;
    if (eventTypeFilter.trim()) f.eventType = eventTypeFilter.trim();
    if (actorFilter.trim()) f.actor = actorFilter.trim();
    if (entityIdSearch.trim()) f.entityId = entityIdSearch.trim();
    return f;
  }, [entityTypeFilter, eventTypeFilter, actorFilter, entityIdSearch]);

  const {
    data: auditEvents = [],
    status: liveStatus,
    lastUpdated,
    isRefreshing,
    refresh,
  } = useLiveAuditEvents({
    filters: queryFilters,
    intervalMs: 20000,
  });

  const resetFilters = () => {
    setEntityTypeFilter('');
    setEventTypeFilter('');
    setActorFilter('');
    setEntityIdSearch('');
  };

  const hasActiveFilters =
    Boolean(entityTypeFilter) ||
    Boolean(eventTypeFilter.trim()) ||
    Boolean(actorFilter.trim()) ||
    Boolean(entityIdSearch.trim());

  const getEventBadge = (eventType?: string) => {
    const type = eventType || 'UNKNOWN';
    if (type.includes('COMMIT') || type.includes('CREATE')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/50">
          <span className="material-symbols-outlined text-[12px]">add_circle</span>
          {type}
        </span>
      );
    }
    if (type.includes('BLOCKED') || type.includes('CANCEL') || type.includes('OFFLINE')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/60 text-rose-300 border border-rose-500/50">
          <span className="material-symbols-outlined text-[12px]">warning</span>
          {type}
        </span>
      );
    }
    if (type.includes('REOPEN') || type.includes('AVAILABLE') || type.includes('UPDATE')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-950/60 text-sky-300 border border-sky-500/50">
          <span className="material-symbols-outlined text-[12px]">sync</span>
          {type}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-surface-container text-on-surface-variant border border-outline-variant/40">
        <span className="material-symbols-outlined text-[12px]">info</span>
        {type}
      </span>
    );
  };

  return (
    <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-300">
      {/* 1. Header & Live Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-xl">history_edu</span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
              Immutable Governance Log
            </span>
          </div>
          <h1 className="text-2xl font-black text-on-surface tracking-tight">
            Operational Audit History
          </h1>
          <p className="text-xs text-on-surface-variant">
            Full compliance trail of operator dispatches, route commitments, road closures, and
            fleet state mutations
          </p>
        </div>

        <LiveStatusIndicator
          status={liveStatus}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />
      </div>

      {/* 2. Role-Based Redaction Notice for OPERATOR */}
      {isOperatorRole && (
        <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-3.5 text-xs text-amber-200 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-400 text-lg shrink-0 mt-0.5">
            lock_clock
          </span>
          <div className="space-y-1">
            <div className="font-bold text-amber-300">
              Security Policy Notice: Operator Role Redaction Active
            </div>
            <p className="text-amber-200/90 leading-relaxed">
              As an operator with standard credentials, sensitive network metadata (
              <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono">clientIp</code>,{' '}
              <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono">
                idempotencyRequestHash
              </code>
              , and{' '}
              <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono">idempotencyKey</code>)
              is automatically redacted from the audit stream. Unmasked security logs are accessible
              exclusively to Dispatchers and System Administrators.
            </p>
          </div>
        </div>
      )}

      {/* 3. Filter Workspace */}
      <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-on-surface uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-primary">filter_list</span>
            <span>Filter Audit Records</span>
          </span>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
              type="button"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Entity Type Filter */}
          <div>
            <label className="text-[10px] font-mono uppercase text-on-surface-variant block mb-1">
              Entity Type
            </label>
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Entity Types</option>
              <option value="REQUEST">REQUEST</option>
              <option value="RESOURCE">RESOURCE</option>
              <option value="ROAD_ZONE">ROAD_ZONE</option>
              <option value="ASSIGNMENT">ASSIGNMENT</option>
            </select>
          </div>

          {/* Event Type Filter */}
          <div>
            <label className="text-[10px] font-mono uppercase text-on-surface-variant block mb-1">
              Event Type (Partial Match)
            </label>
            <input
              type="text"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              placeholder="e.g. COMMITTED, BLOCKED"
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Actor Filter */}
          <div>
            <label className="text-[10px] font-mono uppercase text-on-surface-variant block mb-1">
              Actor / Operator ID
            </label>
            <input
              type="text"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              placeholder="e.g. operator1, SYSTEM"
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Entity ID Search */}
          <div>
            <label className="text-[10px] font-mono uppercase text-on-surface-variant block mb-1">
              Entity Target ID
            </label>
            <input
              type="text"
              value={entityIdSearch}
              onChange={(e) => setEntityIdSearch(e.target.value)}
              placeholder="e.g. req-101, res-boat-1"
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* 4. Audit Table */}
      <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-high border-b border-outline-variant/30 text-on-surface-variant text-[11px] font-mono uppercase">
                <th className="py-3 px-4 font-bold">Timestamp</th>
                <th className="py-3 px-4 font-bold">Action / Event</th>
                <th className="py-3 px-4 font-bold">Entity</th>
                <th className="py-3 px-4 font-bold">Actor</th>
                <th className="py-3 px-4 font-bold">Payload Summary</th>
                <th className="py-3 px-4 font-bold text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/15 font-mono">
              {auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-on-surface-variant font-sans">
                    <span className="material-symbols-outlined text-3xl mb-2 block text-on-surface-variant">
                      manage_search
                    </span>
                    <div className="font-bold text-sm text-on-surface">No Audit Events Found</div>
                    <p className="text-xs text-on-surface-variant max-w-sm mx-auto mt-1">
                      {hasActiveFilters
                        ? 'No records match the current filter query. Try clearing filters.'
                        : 'No audit records have been logged in the system database yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                auditEvents.map((evt, idx) => {
                  const entityType = evt.entityType ?? evt.entity_type ?? 'N/A';
                  const entityId = evt.entityId ?? evt.entity_id ?? 'N/A';
                  const eventType = evt.eventType ?? evt.event_type ?? 'UNKNOWN';
                  const timestampStr = evt.timestamp ?? evt.createdAt ?? evt.created_at;
                  const date = timestampStr ? new Date(timestampStr) : new Date();

                  return (
                    <tr
                      key={evt.id || idx}
                      className="hover:bg-surface-container-high/40 transition-colors"
                    >
                      {/* Timestamp */}
                      <td className="py-3 px-4 text-on-surface-variant whitespace-nowrap text-[11px]">
                        <div>{formatRegionDate(date)}</div>
                        <div className="text-on-surface font-semibold">
                          {formatRegionTime(date)}
                        </div>
                      </td>

                      {/* Event Type Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">{getEventBadge(eventType)}</td>

                      {/* Entity Type & ID */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="text-[10px] text-on-surface-variant block uppercase font-bold">
                          {entityType}
                        </span>
                        <span className="font-bold text-on-surface">{entityId}</span>
                      </td>

                      {/* Actor */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-surface-container-highest text-on-surface border border-outline-variant/30">
                          <span className="material-symbols-outlined text-[13px]">person</span>
                          {evt.actor}
                        </span>
                      </td>

                      {/* Payload preview */}
                      <td className="py-3 px-4 max-w-xs truncate text-[11px] text-on-surface-variant">
                        {evt.payload ? JSON.stringify(evt.payload) : '—'}
                      </td>

                      {/* Inspect Button */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => setSelectedAudit(evt)}
                          className="px-2.5 py-1 rounded bg-surface-container-highest hover:bg-surface-container-high text-primary font-semibold text-xs border border-outline-variant/30 transition-colors inline-flex items-center gap-1 font-sans"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-sm">visibility</span>
                          <span>Details</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Detail Modal */}
      {selectedAudit && (
        <div
          aria-labelledby="audit-detail-title"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
        >
          <div className="bg-surface-container border border-outline-variant rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-outline-variant/20 pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-bold">
                  Audit Event Details
                </span>
                <h3 className="text-lg font-bold text-on-surface" id="audit-detail-title">
                  {selectedAudit.eventType ?? selectedAudit.event_type}
                </h3>
                <p className="text-xs font-mono text-on-surface-variant">
                  ID: {selectedAudit.id || 'N/A'} • Actor: {selectedAudit.actor}
                </p>
              </div>
              <button
                onClick={() => setSelectedAudit(null)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                type="button"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Event Key Fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-surface-container-lowest rounded-xl font-mono text-xs">
              <div>
                <span className="text-[10px] text-on-surface-variant uppercase block">
                  Entity Type
                </span>
                <span className="font-bold text-on-surface">
                  {selectedAudit.entityType ?? selectedAudit.entity_type}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant uppercase block">
                  Entity ID
                </span>
                <span className="font-bold text-on-surface truncate block">
                  {selectedAudit.entityId ?? selectedAudit.entity_id}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant uppercase block">Actor</span>
                <span className="font-bold text-on-surface">{selectedAudit.actor}</span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant uppercase block">
                  Timestamp
                </span>
                <span className="font-bold text-on-surface truncate block">
                  {formatRegionTime(
                    selectedAudit.timestamp ??
                      selectedAudit.createdAt ??
                      selectedAudit.created_at ??
                      Date.now(),
                  )}
                </span>
              </div>
            </div>

            {/* Payload JSON */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-on-surface uppercase flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">
                    data_object
                  </span>
                  <span>Recorded Event Payload</span>
                </span>
                {isOperatorRole && (
                  <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                    SENSITIVE FIELDS REDACTED
                  </span>
                )}
              </div>
              <pre className="p-3 bg-surface-container-lowest border border-outline-variant/30 rounded-xl text-[11px] font-mono text-on-surface overflow-x-auto max-h-60">
                {JSON.stringify(selectedAudit.payload, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                onClick={() => setSelectedAudit(null)}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-colors"
                type="button"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
