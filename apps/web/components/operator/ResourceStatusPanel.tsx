'use client';

import React, { useState } from 'react';
import type { RescueResource, ResourceStatus } from '@floodrelay/shared';
import { apiClient } from '@/lib/api/client';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';

export interface ResourceStatusPanelProps {
  resources: RescueResource[];
  isLoading?: boolean;
  error?: string | null;
  isStale?: boolean;
  onResourceUpdated?: () => void;
  className?: string;
}

export function ResourceStatusPanel({
  resources,
  isLoading = false,
  error = null,
  isStale = false,
  onResourceUpdated,
  className = '',
}: ResourceStatusPanelProps) {
  const { operator } = useOperatorAuth();
  const canManageStatus = hasPermission(operator, 'MANAGE_RESOURCE_STATUS');

  const [selectedResource, setSelectedResource] = useState<RescueResource | null>(null);
  const [targetStatus, setTargetStatus] = useState<ResourceStatus>('AVAILABLE');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  // Dedicated direct database ID override form
  const [directResourceId, setDirectResourceId] = useState<string>('');
  const [directStatus, setDirectStatus] = useState<ResourceStatus>('AVAILABLE');
  const [directReason, setDirectReason] = useState<string>('');
  const [isDirectSubmitting, setIsDirectSubmitting] = useState<boolean>(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [directSuccess, setDirectSuccess] = useState<string | null>(null);
  const [showDirectForm, setShowDirectForm] = useState<boolean>(false);

  const isSimulatedResource = (res: RescueResource) => {
    return res.source === 'SIMULATED';
  };

  const handleOpenDialog = (res: RescueResource) => {
    if (isSimulatedResource(res)) {
      return;
    }
    setSelectedResource(res);
    setTargetStatus(res.status);
    setReason('');
    setMutationError(null);
    setMutationSuccess(null);
  };

  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResource || !canManageStatus) return;

    if (isSimulatedResource(selectedResource)) {
      setMutationError(
        'Mutations against simulated reference assets are blocked. Status updates must target authentic database vehicle IDs.',
      );
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    setMutationSuccess(null);

    try {
      const result = await apiClient.updateResourceStatus(selectedResource.id, {
        status: targetStatus,
        reason: reason.trim() || undefined,
      });

      setMutationSuccess(
        `Resource "${result.resource.name || selectedResource.id}" status updated to ${result.resource.status}.`,
      );
      onResourceUpdated?.();
      setTimeout(() => {
        setSelectedResource(null);
      }, 1500);
    } catch (err) {
      setMutationError((err as Error).message || 'Failed to update resource status');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = directResourceId.trim();
    if (!cleanId || !canManageStatus) return;

    const knownResource = resources.find((r) => r.id === cleanId);
    if (knownResource && isSimulatedResource(knownResource)) {
      setDirectError(
        'Mutations against simulated resources are blocked. Enter an authentic operational resource ID.',
      );
      return;
    }

    setIsDirectSubmitting(true);
    setDirectError(null);
    setDirectSuccess(null);

    try {
      const result = await apiClient.updateResourceStatus(cleanId, {
        status: directStatus,
        reason: directReason.trim() || undefined,
      });

      setDirectSuccess(
        `Resource "${result.resource.name || cleanId}" status updated to ${result.resource.status}.`,
      );
      onResourceUpdated?.();
      setDirectReason('');
      setTimeout(() => {
        setDirectSuccess(null);
      }, 3000);
    } catch (err) {
      setDirectError((err as Error).message || 'Failed to update operational resource status');
    } finally {
      setIsDirectSubmitting(false);
    }
  };

  const getStatusBadge = (status: ResourceStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            AVAILABLE
          </span>
        );
      case 'ASSIGNED':
      case 'EN_ROUTE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            {status}
          </span>
        );
      case 'MAINTENANCE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            MAINTENANCE
          </span>
        );
      case 'OFFLINE':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            OFFLINE
          </span>
        );
    }
  };

  return (
    <div
      className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-5 space-y-4 ${className}`}
      data-testid="resource-status-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">directions_boat</span>
          <div>
            <h3 className="font-manrope text-base font-bold text-on-surface">
              Rescue Fleet & Resource Roster
            </h3>
            <span className="text-[11px] font-mono text-emerald-500 font-bold">
              [AUTHORITATIVE ROSTER]
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManageStatus && (
            <button
              className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
              onClick={() => setShowDirectForm(!showDirectForm)}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">tune</span>
              <span>{showDirectForm ? 'Hide Override Form' : 'Direct DB ID Override'}</span>
            </button>
          )}
          {!canManageStatus && (
            <span className="text-[11px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
              Role ({operator?.role || 'OPERATOR'}): View Only
            </span>
          )}
        </div>
      </div>

      {/* Connection Error Banner */}
      {error && (
        <div
          className="p-3 bg-rose-950/30 border border-rose-500/40 rounded-lg text-xs text-rose-200 flex items-start gap-2.5"
          role="alert"
        >
          <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">
            error
          </span>
          <div className="space-y-1">
            <div className="font-bold text-rose-300">Resource Inventory Connection Error</div>
            <p className="text-rose-200/90 leading-relaxed text-[11px]">{error}</p>
          </div>
        </div>
      )}

      {/* Stale Cache Notice */}
      {!error && isStale && (
        <div className="p-2.5 bg-amber-950/20 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-400 text-sm shrink-0">history</span>
          <span className="text-[11px]">
            Displaying cached resource roster. Reconnecting to live inventory...
          </span>
        </div>
      )}

      {/* Direct DB Resource Status Override Form */}
      {showDirectForm && canManageStatus && (
        <form
          className="p-4 bg-surface-container border border-primary/30 rounded-xl space-y-3"
          onSubmit={handleDirectStatusUpdate}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
              <span className="material-symbols-outlined text-sm">terminal</span>
              Authoritative Operational Resource Status Override
            </h4>
            <span className="text-[10px] text-on-surface-variant font-mono">
              PATCH /operations/resources/:id/status
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-on-surface" htmlFor="directIdInput">
                Database Resource ID (UUID)
              </label>
              <input
                className="w-full h-9 px-2.5 rounded-lg bg-surface border border-outline-variant text-xs font-mono text-on-surface focus:ring-1 focus:ring-primary placeholder:text-outline"
                id="directIdInput"
                onChange={(e) => setDirectResourceId(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                required
                type="text"
                value={directResourceId}
              />
            </div>

            <div className="space-y-1">
              <label
                className="text-[11px] font-semibold text-on-surface"
                htmlFor="directStatusSelect"
              >
                Target Status
              </label>
              <select
                className="w-full h-9 px-2.5 rounded-lg bg-surface border border-outline-variant text-xs font-semibold text-on-surface focus:ring-1 focus:ring-primary"
                id="directStatusSelect"
                onChange={(e) => setDirectStatus(e.target.value as ResourceStatus)}
                value={directStatus}
              >
                <option value="AVAILABLE">AVAILABLE (Ready)</option>
                <option value="MAINTENANCE">MAINTENANCE (Servicing)</option>
                <option value="OFFLINE">OFFLINE (Unavailable)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label
                className="text-[11px] font-semibold text-on-surface"
                htmlFor="directReasonInput"
              >
                Operational Reason
              </label>
              <input
                className="w-full h-9 px-2.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface focus:ring-1 focus:ring-primary placeholder:text-outline"
                id="directReasonInput"
                onChange={(e) => setDirectReason(e.target.value)}
                placeholder="e.g. Returning from bayou mission"
                type="text"
                value={directReason}
              />
            </div>
          </div>

          {directError && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300">
              {directError}
            </div>
          )}

          {directSuccess && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300">
              {directSuccess}
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              disabled={isDirectSubmitting || !directResourceId.trim()}
              type="submit"
            >
              {isDirectSubmitting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-xs">
                    progress_activity
                  </span>
                  <span>Updating...</span>
                </>
              ) : (
                <span>Dispatch Status Update</span>
              )}
            </button>
          </div>
        </form>
      )}

      {isLoading && resources.length === 0 ? (
        <div className="py-12 text-center text-on-surface-variant font-mono text-xs flex flex-col items-center justify-center gap-2">
          <span className="material-symbols-outlined animate-spin text-lg text-primary">
            progress_activity
          </span>
          <span>Loading authoritative rescue fleet roster...</span>
        </div>
      ) : resources.length === 0 ? (
        <div className="py-12 text-center text-on-surface-variant font-mono text-xs border border-dashed border-outline-variant/30 rounded-xl">
          No rescue resources registered in database.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-outline-variant/30 text-on-surface-variant font-mono text-[11px]">
                <th className="pb-2.5 font-semibold">Asset ID & Name</th>
                <th className="pb-2.5 font-semibold">Type</th>
                <th className="pb-2.5 font-semibold">Capacity</th>
                <th className="pb-2.5 font-semibold">Speed</th>
                <th className="pb-2.5 font-semibold">Status</th>
                <th className="pb-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/15 font-mono text-xs">
              {resources.map((res) => {
                const simulated = isSimulatedResource(res);
                return (
                  <tr className="hover:bg-surface-container/50 transition-colors" key={res.id}>
                    <td className="py-2.5 font-bold text-on-surface">
                      <span className="block font-sans text-xs">{res.name || res.id}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-on-surface-variant font-mono">
                          {res.id}
                        </span>
                        {res.source === 'REAL' ? (
                          <span className="text-[9px] font-mono px-1 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-600/40">
                            REAL
                          </span>
                        ) : res.source === 'SIMULATED' ? (
                          <span className="text-[9px] font-mono px-1 rounded bg-amber-950/60 text-amber-400 border border-amber-600/40">
                            SIMULATED
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2.5 text-on-surface-variant">{res.type}</td>
                    <td className="py-2.5 text-on-surface">{res.capacity} pax</td>
                    <td className="py-2.5 text-on-surface">{res.speedKmH} km/h</td>
                    <td className="py-2.5">{getStatusBadge(res.status)}</td>
                    <td className="py-2.5 text-right font-sans">
                      {simulated ? (
                        <span
                          className="text-[10px] font-mono text-on-surface-variant/70 italic px-2 py-0.5 rounded bg-surface-container"
                          title="Simulated resource — status cannot be updated in database"
                        >
                          Read-only (Simulated)
                        </span>
                      ) : canManageStatus ? (
                        <button
                          className="px-2.5 py-1 rounded border border-outline-variant hover:bg-surface-variant font-semibold text-[11px] text-primary transition-colors"
                          onClick={() => handleOpenDialog(res)}
                          type="button"
                        >
                          Update
                        </button>
                      ) : (
                        <span className="text-[10px] text-on-surface-variant/60 italic">
                          Read-only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Resource Status Mutation Modal */}
      {selectedResource && (
        <div
          aria-labelledby="status-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
        >
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <h4 className="font-bold text-base text-on-surface" id="status-dialog-title">
                Modify Resource Status
              </h4>
              <button
                className="p-1 rounded text-on-surface-variant hover:text-on-surface"
                onClick={() => setSelectedResource(null)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              Update availability state for{' '}
              <strong className="text-on-surface">
                {selectedResource.name} ({selectedResource.id})
              </strong>
              . Consequential changes automatically trigger an operational event and scope
              evaluation.
            </p>

            <form className="space-y-4" onSubmit={handleStatusUpdate}>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface" htmlFor="statusSelect">
                  New Operational Status
                </label>
                <select
                  className="w-full h-10 px-3 rounded-lg bg-surface border border-outline-variant text-sm font-semibold text-on-surface focus:ring-2 focus:ring-primary"
                  id="statusSelect"
                  onChange={(e) => setTargetStatus(e.target.value as ResourceStatus)}
                  value={targetStatus}
                >
                  <option value="AVAILABLE">AVAILABLE (Ready for immediate dispatch)</option>
                  <option value="MAINTENANCE">MAINTENANCE (Fueling / mechanical repairs)</option>
                  <option value="OFFLINE">OFFLINE (Withdrawn from sector service)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface" htmlFor="reasonInput">
                  Operational Reason (Logged in Audit Trail)
                </label>
                <input
                  className="w-full h-10 px-3 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface focus:ring-2 focus:ring-primary placeholder:text-outline"
                  id="reasonInput"
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Engine impeller obstruction cleared"
                  type="text"
                  value={reason}
                />
              </div>

              {mutationError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-800 dark:text-rose-300">
                  {mutationError}
                </div>
              )}

              {mutationSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-800 dark:text-emerald-300">
                  {mutationSuccess}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
                <button
                  className="px-4 py-2 rounded-lg border border-outline-variant text-xs font-semibold text-on-surface hover:bg-surface-variant transition-colors"
                  onClick={() => setSelectedResource(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  disabled={isSubmitting || targetStatus === selectedResource.status}
                  type="submit"
                >
                  {isSubmitting ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">
                        progress_activity
                      </span>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Confirm Status Change</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
