'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { OperationalEvent, AffectedScopeResult, RepairResult } from '@/lib/api/types';
import { apiClient } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';
import { OperationalEventCard } from './OperationalEventCard';
import { AffectedScopePanel } from './AffectedScopePanel';
import RepairComparison from './repair/RepairComparison';

export interface OperationalEventFeedProps {
  events: OperationalEvent[];
  isLoading?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export function OperationalEventFeed({
  events,
  isLoading = false,
  className = '',
}: OperationalEventFeedProps) {
  const { operator } = useOperatorAuth();
  const [selectedEvent, setSelectedEvent] = useState<OperationalEvent | null>(null);
  const [affectedScope, setAffectedScope] = useState<AffectedScopeResult | null>(null);
  const [isLoadingScope, setIsLoadingScope] = useState<boolean>(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  // Repair execution state
  const [isRepairing, setIsRepairing] = useState<boolean>(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [isSolverUnavailable, setIsSolverUnavailable] = useState<boolean>(false);
  const [showComparisonModal, setShowComparisonModal] = useState<boolean>(false);

  const canRequestRepair = hasPermission(operator, 'REQUEST_REPAIR');

  const handleSelectEvent = async (event: OperationalEvent) => {
    setSelectedEvent(event);
    setAffectedScope(null);
    setScopeError(null);
    setRepairResult(null);
    setRepairError(null);
    setIsLoadingScope(true);

    try {
      const scope = await apiClient.getAffectedScope(event.id);
      setAffectedScope(scope);
    } catch (err) {
      setScopeError((err as Error).message || 'Failed to evaluate affected scope');
    } finally {
      setIsLoadingScope(false);
    }
  };

  const handleTriggerRepair = async (eventId: string) => {
    if (!canRequestRepair) return;
    setIsRepairing(true);
    setRepairError(null);
    setRepairResult(null);

    try {
      const res = await apiClient.requestRepair({ eventId });
      setRepairResult(res);
      setIsSolverUnavailable(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.statusCode === 503) {
        setIsSolverUnavailable(true);
        setRepairError(
          'Phase 5 Part 2 solver engine is currently undergoing integration. Live solver repair proposal calculation is unavailable.',
        );
      } else {
        setRepairError((err as Error).message || 'Failed to trigger plan repair proposal');
      }
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div className={`space-y-4 ${className}`} data-testid="operational-event-feed">
      {isLoading && events.length === 0 ? (
        <div className="p-8 text-center bg-surface-container-lowest border border-outline-variant rounded-xl">
          <div className="flex items-center justify-center gap-2 text-primary font-medium text-sm">
            <span className="material-symbols-outlined animate-spin text-xl">
              progress_activity
            </span>
            <span>Loading operational events from live node...</span>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="p-12 text-center bg-surface-container-lowest border border-outline-variant rounded-xl">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">
            event_busy
          </span>
          <h3 className="font-semibold text-base text-on-surface">No Operational Events</h3>
          <p className="text-xs text-on-surface-variant max-w-sm mx-auto mt-1">
            No events match the selected criteria. The system continuously listens for incoming
            requests, resource changes, and road closures.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {events.map((evt) => (
            <OperationalEventCard
              event={evt}
              isSelected={selectedEvent?.id === evt.id}
              key={evt.id}
              onSelect={handleSelectEvent}
            />
          ))}
        </div>
      )}

      {/* Impact & Scope Drawer / Modal */}
      {selectedEvent && (
        <div
          aria-labelledby="event-details-title"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
        >
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-outline-variant/20 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-bold">
                  Operational Event Inspection
                </span>
                <h3 className="text-lg font-bold text-on-surface" id="event-details-title">
                  {selectedEvent.type}
                </h3>
                <p className="text-xs font-mono text-on-surface-variant">
                  Event ID: {selectedEvent.id} • Target: {selectedEvent.entityType} (
                  {selectedEvent.entityId})
                </p>
              </div>
              <button
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
                onClick={() => setSelectedEvent(null)}
                title="Close modal"
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Event Overview Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-surface-container rounded-xl text-xs font-mono">
              <div>
                <span className="text-[10px] text-on-surface-variant block uppercase">
                  Processing
                </span>
                <span className="font-bold text-on-surface">
                  {selectedEvent.processingStatus || 'RECORDED'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant block uppercase">Actor</span>
                <span className="font-bold text-on-surface">{selectedEvent.actorType}</span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant block uppercase">
                  Recorded At
                </span>
                <span className="font-bold text-on-surface truncate block">
                  {new Date(selectedEvent.recordedAt).toLocaleTimeString()}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-on-surface-variant block uppercase">
                  Correlation
                </span>
                <span className="font-bold text-on-surface truncate block">
                  {selectedEvent.correlationId || 'N/A'}
                </span>
              </div>
            </div>

            {/* Event Payload */}
            <div>
              <h4 className="text-xs font-bold text-on-surface uppercase mb-1.5 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-primary">data_object</span>
                <span>Event Payload</span>
              </h4>
              <pre className="p-3 bg-surface border border-outline-variant rounded-xl text-[11px] font-mono text-on-surface overflow-x-auto max-h-40">
                {JSON.stringify(selectedEvent.payload, null, 2)}
              </pre>
            </div>

            {/* Affected Scope Evaluation */}
            <div className="p-4 bg-surface-container rounded-xl border border-outline-variant/40 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-on-surface uppercase flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-tertiary">hub</span>
                  <span>Evaluated Affected Scope</span>
                </h4>
                {isLoadingScope && (
                  <span className="text-xs text-primary font-mono flex items-center gap-1">
                    <span className="material-symbols-outlined animate-spin text-sm">
                      progress_activity
                    </span>
                    <span>Evaluating scope...</span>
                  </span>
                )}
              </div>

              {scopeError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-800 dark:text-rose-300">
                  {scopeError}
                </div>
              )}

              {affectedScope && (
                <AffectedScopePanel
                  scope={affectedScope}
                  onTriggerRepair={() => handleTriggerRepair(selectedEvent.id)}
                  isRepairing={isRepairing}
                  canRequestRepair={canRequestRepair}
                />
              )}
            </div>

            {/* Repair Trigger Status & Warning */}
            {repairError && (
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-base text-amber-600 shrink-0 mt-0.5">
                    info
                  </span>
                  <div>
                    <span className="font-bold block">Solver Status Notice</span>
                    <span>{repairError}</span>
                  </div>
                </div>
                {isSolverUnavailable && (
                  <div className="pt-1">
                    <button
                      onClick={() => setShowComparisonModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-500/40 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">science</span>
                      <span>Preview Simulated Repair Diff & Churn</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {repairResult && (
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
                <span className="font-bold block">Plan Repair Proposal Received:</span>
                <span>
                  Status: {repairResult.status}. Unserved requests:{' '}
                  {repairResult.unservedRequestIds.length}.
                </span>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowComparisonModal(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs transition-colors"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">compare_arrows</span>
                    <span>Compare Repair Diff</span>
                  </button>
                  <Link
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant font-semibold text-xs text-on-surface hover:bg-surface-variant transition-colors"
                    href="/operator/assignments"
                  >
                    <span>View Assignment Overview</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/20">
              <Link
                className="text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1"
                href="/operator/assignments"
              >
                <span className="material-symbols-outlined text-sm">assignment</span>
                <span>Go to Assignment Overview</span>
              </Link>

              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface font-semibold text-xs hover:bg-surface-variant transition-colors"
                  onClick={() => setSelectedEvent(null)}
                  type="button"
                >
                  Close
                </button>

                {canRequestRepair ? (
                  <button
                    className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                    disabled={isRepairing || !affectedScope?.repairEligible}
                    onClick={() => handleTriggerRepair(selectedEvent.id)}
                    type="button"
                  >
                    {isRepairing ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-sm">
                          progress_activity
                        </span>
                        <span>Requesting Repair...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">build</span>
                        <span>Request Incremental Repair</span>
                      </>
                    )}
                  </button>
                ) : (
                  <span className="text-[11px] font-mono text-on-surface-variant italic px-2">
                    Role ({operator?.role || 'OPERATOR'}) cannot trigger repairs
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Repair Comparison Modal */}
      {showComparisonModal && (
        <div
          aria-labelledby="repair-comparison-title"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
        >
          <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <RepairComparison
              isSolverUnavailable={isSolverUnavailable}
              isSimulated={isSolverUnavailable || !repairResult}
              repairResult={repairResult}
              onClose={() => setShowComparisonModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
