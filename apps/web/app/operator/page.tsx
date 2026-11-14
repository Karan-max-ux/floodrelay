'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { RescueRequest, RescueResource } from '@floodrelay/shared';
import { apiClient, isAbortError } from '@/lib/api/client';
import type { AssignmentRecord, OperationalEvent } from '@/lib/api/types';
import { useLivePolling } from '@/hooks/useLivePolling';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';
import { LiveStatusIndicator } from '@/components/operator/LiveStatusIndicator';
import { ResourceStatusPanel } from '@/components/operator/ResourceStatusPanel';
import { RoadBlockageModal } from '@/components/operator/RoadBlockageModal';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface DashboardData {
  requests: RescueRequest[];
  assignments: AssignmentRecord[] | null;
  recentEvents: OperationalEvent[] | null;
  resources: RescueResource[] | null;
  assignmentsError: string | null;
  assignmentsStale: boolean;
  eventsError: string | null;
  eventsStale: boolean;
  resourcesError: string | null;
  resourcesStale: boolean;
  hasPartialFailure: boolean;
}

export default function OperatorOverviewPage() {
  const { operator } = useOperatorAuth();
  const canManageRoadZones = hasPermission(operator, 'MANAGE_BLOCKED_ZONES');

  const [isRoadBlockageOpen, setIsRoadBlockageOpen] = useState<boolean>(false);

  const previousDataRef = React.useRef<{
    assignments: AssignmentRecord[] | null;
    recentEvents: OperationalEvent[] | null;
    resources: RescueResource[] | null;
  }>({
    assignments: null,
    recentEvents: null,
    resources: null,
  });

  // Combined Live Polling for Dashboard with Domain Error Preservation
  const fetchDashboardData = useCallback(async (signal: AbortSignal): Promise<DashboardData> => {
    const [requestsResult, assignmentsResult, eventsResult, resourcesResult] =
      await Promise.allSettled([
        apiClient.listRequests(undefined, signal),
        apiClient.listAssignments(undefined, signal),
        apiClient.listOperationalEvents({ limit: 5 }, signal),
        apiClient.listResources(undefined, signal),
      ]);

    // Check for intentional aborts/cancellations before logging or reporting failures
    if (signal.aborted) {
      throw (
        (requestsResult.status === 'rejected' && isAbortError(requestsResult.reason)
          ? requestsResult.reason
          : null) || new DOMException('The operation was aborted', 'AbortError')
      );
    }

    if (requestsResult.status === 'rejected') {
      if (isAbortError(requestsResult.reason)) {
        throw requestsResult.reason;
      }
      console.error('Failed to load requests:', requestsResult.reason);
      throw requestsResult.reason;
    }
    const requests = requestsResult.value || [];

    // Assignments domain error preservation
    let assignments: AssignmentRecord[] | null = null;
    let assignmentsError: string | null = null;
    let assignmentsStale = false;

    if (assignmentsResult.status === 'fulfilled') {
      assignments = assignmentsResult.value || [];
      previousDataRef.current.assignments = assignments;
    } else {
      const err = assignmentsResult.reason as Error;
      if (!isAbortError(err)) {
        assignmentsError = err?.message || 'Failed to fetch assignments';
        console.warn('Assignments fetch failed in dashboard polling:', err);
        if (previousDataRef.current.assignments !== null) {
          assignments = previousDataRef.current.assignments;
          assignmentsStale = true;
        }
      } else {
        assignments = previousDataRef.current.assignments;
      }
    }

    // Events domain error preservation
    let recentEvents: OperationalEvent[] | null = null;
    let eventsError: string | null = null;
    let eventsStale = false;

    if (eventsResult.status === 'fulfilled') {
      recentEvents = eventsResult.value || [];
      previousDataRef.current.recentEvents = recentEvents;
    } else {
      const err = eventsResult.reason as Error;
      if (!isAbortError(err)) {
        eventsError = err?.message || 'Failed to fetch operational events';
        console.warn('Operational events fetch failed in dashboard polling:', err);
        if (previousDataRef.current.recentEvents !== null) {
          recentEvents = previousDataRef.current.recentEvents;
          eventsStale = true;
        }
      } else {
        recentEvents = previousDataRef.current.recentEvents;
      }
    }

    // Resources domain error preservation (Authoritative Inventory)
    let resources: RescueResource[] | null = null;
    let resourcesError: string | null = null;
    let resourcesStale = false;

    if (resourcesResult.status === 'fulfilled') {
      resources = resourcesResult.value || [];
      previousDataRef.current.resources = resources;
    } else {
      const err = resourcesResult.reason as Error;
      if (!isAbortError(err)) {
        resourcesError = err?.message || 'Failed to fetch rescue resources';
        console.warn('Rescue resources fetch failed in dashboard polling:', err);
        if (previousDataRef.current.resources !== null) {
          resources = previousDataRef.current.resources;
          resourcesStale = true;
        }
      } else {
        resources = previousDataRef.current.resources;
      }
    }

    return {
      requests,
      assignments,
      recentEvents,
      resources,
      assignmentsError,
      assignmentsStale,
      eventsError,
      eventsStale,
      resourcesError,
      resourcesStale,
      hasPartialFailure: Boolean(assignmentsError || eventsError || resourcesError),
    };
  }, []);

  const {
    data: dashboardData,
    isLoading,
    isRefreshing,
    status,
    lastUpdated,
    error,
    refresh,
  } = useLivePolling<DashboardData>(fetchDashboardData, {
    intervalMs: 20000,
  });

  const requests = useMemo(() => dashboardData?.requests || [], [dashboardData]);
  const assignments = useMemo(() => dashboardData?.assignments || [], [dashboardData]);
  const recentEvents = useMemo(() => dashboardData?.recentEvents || [], [dashboardData]);
  const resources = useMemo(() => dashboardData?.resources || [], [dashboardData]);
  const resourcesError = dashboardData?.resourcesError || null;
  const resourcesStale = Boolean(dashboardData?.resourcesStale);

  // Compute live real-time metrics
  const metrics = useMemo(() => {
    const totalRequests = requests.length;
    const criticalCount = requests.filter((r) => r.urgency === 'CRITICAL').length;
    const highCount = requests.filter((r) => r.urgency === 'HIGH').length;
    const mediumCount = requests.filter((r) => r.urgency === 'MEDIUM').length;
    const lowCount = requests.filter((r) => r.urgency === 'LOW').length;
    const pendingCount = requests.filter((r) => !r.status || r.status === 'PENDING').length;
    const assignedCount = requests.filter((r) => r.status === 'ASSIGNED').length;
    const totalPassengers = requests.reduce((acc, r) => acc + (r.peopleCount || 0), 0);
    const medicalCount = requests.filter((r) => r.medicalNeeds).length;
    const duplicateCount = requests.filter((r) => r.isFlaggedDuplicate).length;

    const proposedAssignments = assignments.filter((a) => a.status === 'PROPOSED');
    const committedAssignments = assignments.filter((a) => a.status === 'COMMITTED');

    // Calculate unserved demand across proposed plans
    const latestProposed = proposedAssignments[0];
    const unservedCount = latestProposed?.unserved?.length || 0;

    // Authoritative rescue resource metrics
    const realResources = resources.filter((res) => res.source !== 'SIMULATED');
    const simulatedResources = resources.filter((res) => res.source === 'SIMULATED');
    const availableResources = realResources.filter((res) => res.status === 'AVAILABLE').length;
    const offlineResources = realResources.filter(
      (res) => res.status === 'OFFLINE' || res.status === 'MAINTENANCE',
    ).length;

    return {
      totalRequests,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      pendingCount,
      assignedCount,
      totalPassengers,
      medicalCount,
      duplicateCount,
      proposedAssignmentsCount: proposedAssignments.length,
      committedAssignmentsCount: committedAssignments.length,
      unservedCount,
      availableResources,
      offlineResources,
      realResourcesCount: realResources.length,
      simulatedResourcesCount: simulatedResources.length,
    };
  }, [requests, assignments, resources]);

  // Sort top urgent requests for triage queue
  const criticalTriageQueue = useMemo(() => {
    const urgencyWeight: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return [...requests]
      .filter(
        (r) =>
          !r.status || r.status === 'PENDING' || r.urgency === 'CRITICAL' || r.urgency === 'HIGH',
      )
      .sort((a, b) => {
        const weightDiff = (urgencyWeight[b.urgency] || 0) - (urgencyWeight[a.urgency] || 0);
        if (weightDiff !== 0) return weightDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 5);
  }, [requests]);

  const latestAssignment = assignments[0] || null;

  return (
    <div
      className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6"
      data-testid="operator-dashboard"
    >
      {/* Top Banner Notice: Live Polling Status Strip */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="font-bold text-lg md:text-xl text-on-surface">
              Sector 4 Emergency Operations Command
            </h1>
          </div>
          <p className="text-xs text-on-surface-variant font-mono mt-0.5">
            Harris County Flood Basin • Live Decision-Support System
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageRoadZones && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors"
              onClick={() => setIsRoadBlockageOpen(true)}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">block</span>
              <span>Register Road Hazard</span>
            </button>
          )}

          <LiveStatusIndicator
            isRefreshing={isRefreshing}
            lastUpdated={lastUpdated}
            onRefresh={refresh}
            status={status}
          />
        </div>
      </div>

      {/* Operational Alerts Strip */}
      {metrics.criticalCount > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-amber-600 text-lg">crisis_alert</span>
            <div>
              <span className="font-bold">Active Critical Priority Distress Alerts: </span>
              <span>{metrics.criticalCount} critical requests awaiting dispatch confirmation.</span>
            </div>
          </div>
          <Link
            className="text-primary font-bold hover:underline font-mono text-[11px]"
            href="/operator/requests?urgency=CRITICAL"
          >
            Review Critical Requests →
          </Link>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-200 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-400">error</span>
            <span>{error.message || 'Unable to connect to FloodRelay command backend'}</span>
          </div>
          <button
            className="px-3 py-1 rounded bg-red-900 hover:bg-red-800 text-white font-bold transition-colors"
            onClick={() => void refresh()}
            type="button"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Partial Telemetry Failure Notice */}
      {dashboardData?.hasPartialFailure && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-600/60 text-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-amber-400 text-lg">warning</span>
            <div>
              <span className="font-bold">Partial Telemetry Warning: </span>
              <span>
                One or more dashboard feeds failed to update. Previously cached data is retained
                where available (not zeroed).
              </span>
              <div className="text-[11px] font-mono text-amber-300/90 mt-0.5 space-x-2">
                {dashboardData.assignmentsError && (
                  <span>
                    • Assignments: <strong>{dashboardData.assignmentsError}</strong> (
                    {dashboardData.assignmentsStale ? 'Cached data retained' : 'No prior cache'})
                  </span>
                )}
                {dashboardData.eventsError && (
                  <span>
                    • Events: <strong>{dashboardData.eventsError}</strong> (
                    {dashboardData.eventsStale ? 'Cached data retained' : 'No prior cache'})
                  </span>
                )}
                {dashboardData.resourcesError && (
                  <span>
                    • Resources: <strong>{dashboardData.resourcesError}</strong> (
                    {dashboardData.resourcesStale ? 'Cached data retained' : 'No prior cache'})
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            className="px-2.5 py-1 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-100 font-semibold border border-amber-500/50 text-xs transition-colors"
            onClick={() => void refresh()}
            type="button"
          >
            Retry Feeds
          </button>
        </div>
      )}

      {/* 4 PRIMARY METRIC CARDS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Authoritative Rescue Fleet */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">
              Fleet Roster
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                resourcesError
                  ? 'bg-rose-950/60 text-rose-400 border border-rose-500/40'
                  : resourcesStale
                    ? 'bg-amber-950/60 text-amber-400 border border-amber-500/40'
                    : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40'
              }`}
            >
              {resourcesError ? 'FEED ERROR' : resourcesStale ? 'STALE' : 'AUTHORITATIVE'}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-inter text-2xl lg:text-3xl font-extrabold text-on-surface">
              {isLoading && dashboardData?.resources === null ? '—' : resources.length}
            </span>
            <span className="text-xs text-on-surface-variant font-medium">Active Assets</span>
          </div>
          <div className="text-[10px] text-on-surface-variant font-mono leading-tight mb-2">
            {resourcesError ? (
              <span className="text-rose-400">Failed to poll resource roster</span>
            ) : resourcesStale ? (
              <span className="text-amber-400">Cached resource roster (reconnecting)</span>
            ) : (
              <span>Authoritative roster (GET /operations/resources)</span>
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-outline-variant/40 flex items-center justify-between text-[11px] text-on-surface-variant font-mono">
            <span>Standby: {metrics.availableResources} craft</span>
            <span className="text-on-surface-variant/70">
              {metrics.simulatedResourcesCount > 0
                ? `${metrics.simulatedResourcesCount} simulated`
                : 'All Real'}
            </span>
          </div>
        </div>

        {/* Metric 2: Live Distress Queue */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">
              Distress Queue
            </span>
            <span className="material-symbols-outlined text-tertiary text-[20px]">
              crisis_alert
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-inter text-2xl lg:text-3xl font-extrabold text-tertiary">
              {isLoading ? '—' : metrics.criticalCount}
            </span>
            <span className="text-xs text-tertiary font-bold">Critical Priority</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <span className="text-amber-800 font-semibold">{metrics.highCount} High</span>
            <span>•</span>
            <span>{metrics.mediumCount} Moderate</span>
            <span>•</span>
            <span className="font-mono font-bold text-on-surface">
              {metrics.totalRequests} In Queue
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-outline-variant/40 flex items-center justify-between text-[11px]">
            <Link className="text-primary font-semibold hover:underline" href="/operator/requests">
              Manage Requests ({metrics.pendingCount} Pending) →
            </Link>
          </div>
        </div>

        {/* Metric 3: Assignments & Unserved Demand */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">
              Missions & Demand
            </span>
            {dashboardData?.assignmentsStale ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/60 text-amber-300 border border-amber-600/40">
                CACHED
              </span>
            ) : dashboardData?.assignmentsError && !dashboardData?.assignments ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-950/60 text-rose-300 border border-rose-600/40">
                UNAVAILABLE
              </span>
            ) : (
              <span className="material-symbols-outlined text-primary text-[20px]">assignment</span>
            )}
          </div>
          {dashboardData?.assignmentsError && !dashboardData?.assignments ? (
            <div className="space-y-1 mb-2">
              <span className="font-inter text-lg lg:text-xl font-bold text-rose-400">
                Data Unavailable
              </span>
              <p
                className="text-[10px] text-rose-300/80 font-mono truncate"
                title={dashboardData.assignmentsError}
              >
                {dashboardData.assignmentsError}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-inter text-2xl lg:text-3xl font-extrabold text-on-surface">
                  {metrics.committedAssignmentsCount}
                </span>
                <span className="text-xs text-on-surface-variant font-medium">
                  Committed Active
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-on-surface-variant font-mono">
                <span>{metrics.proposedAssignmentsCount} Proposed</span>
                <span className="text-amber-700 font-bold">{metrics.unservedCount} Unserved</span>
              </div>
            </>
          )}
          <div className="mt-2 pt-2 border-t border-outline-variant/40 flex items-center justify-between text-[11px]">
            <Link
              className="text-primary font-semibold hover:underline"
              href="/operator/assignments"
            >
              Review Proposals →
            </Link>
          </div>
        </div>

        {/* Metric 4: Optimization Coverage */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">
              Latest Solver Plan
            </span>
            <span className="material-symbols-outlined text-primary text-[20px]">route</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            {dashboardData?.assignmentsError && !latestAssignment ? (
              <span className="font-inter text-sm font-bold text-rose-400">
                Unavailable (Fetch Error)
              </span>
            ) : latestAssignment ? (
              <>
                <span className="font-inter text-2xl lg:text-3xl font-extrabold text-primary">
                  {latestAssignment.metrics?.coveragePercent || 0}%
                </span>
                <span className="text-xs text-primary font-bold">{latestAssignment.id}</span>
              </>
            ) : (
              <>
                <span className="font-inter text-lg lg:text-xl font-bold text-on-surface-variant">
                  Standby
                </span>
                <span className="text-xs text-on-surface-variant">Solver</span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-on-surface-variant">
            {latestAssignment ? (
              <>
                <span>{latestAssignment.routes?.length || 0} Routes Planned</span>
                <span className="text-amber-800 font-semibold">
                  {latestAssignment.unserved?.length || 0} Unserved
                </span>
              </>
            ) : (
              <span className="italic text-[11px]">Human-supervised solver ready</span>
            )}
          </div>
          <div className="mt-2 pt-2 border-t border-outline-variant/40 flex items-center justify-between text-[11px]">
            <Link
              className="text-primary font-semibold hover:underline"
              href="/operator/assignments"
            >
              Assignment Workspace →
            </Link>
          </div>
        </div>
      </section>

      {/* TWO-COLUMN WORKBENCH: Active Triage Queue & Map Shortcut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: High-Priority Inbound Queue (7 cols) */}
        <section className="lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary">emergency</span>
                <h2 className="text-base font-bold text-on-surface">Critical Triage Queue</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-tertiary-container text-on-tertiary">
                  {criticalTriageQueue.length} In Focus
                </span>
              </div>
              <Link
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                href="/operator/requests"
              >
                <span>Full List ({metrics.totalRequests})</span>
                <span className="material-symbols-outlined text-xs">arrow_forward</span>
              </Link>
            </div>

            {isLoading && requests.length === 0 ? (
              <div className="space-y-3 py-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-surface-container-low animate-pulse" />
                ))}
              </div>
            ) : criticalTriageQueue.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant space-y-3 border border-dashed border-outline-variant rounded-lg">
                <span className="material-symbols-outlined text-4xl text-emerald-500">
                  task_alt
                </span>
                <h3 className="text-sm font-bold text-on-surface">Triage Queue Clear</h3>
                <p className="text-xs max-w-sm mx-auto">
                  No pending citizen rescue requests currently in database. New citizen distress
                  calls submitted via the public portal will appear here in real time.
                </p>
                <div className="pt-2">
                  <Link
                    href="/citizen/request"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container transition-colors"
                  >
                    <span>Test Citizen Portal Intake</span>
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {criticalTriageQueue.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 rounded-lg border border-outline-variant/70 bg-surface hover:bg-surface-container-low transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-on-surface">
                          {req.id}
                        </span>
                        <UrgencyBadge urgency={req.urgency} />
                        <StatusBadge status={req.status || 'PENDING'} />
                        {req.medicalNeeds && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-900 font-semibold flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[12px]">
                              medical_services
                            </span>
                            Medical
                          </span>
                        )}
                        {req.isFlaggedDuplicate && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-900 font-bold">
                            DUP
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant line-clamp-1">
                        {req.notes || 'No caller notes provided.'}
                      </p>
                      <div className="text-[11px] text-on-surface-variant font-mono">
                        <span>{req.peopleCount} passengers</span> •{' '}
                        <span>
                          GPS: {req.lat.toFixed(4)}, {req.lng.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <Link
                      className="self-end sm:self-auto px-3 py-1.5 rounded bg-surface-container-high text-xs font-semibold text-on-surface hover:bg-primary hover:text-on-primary transition-colors text-center"
                      href={`/operator/requests?inspect=${encodeURIComponent(req.id)}`}
                    >
                      Inspect
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-outline-variant/60 flex items-center justify-between text-xs text-on-surface-variant">
            <span>
              Showing top {criticalTriageQueue.length} urgent ticket
              {criticalTriageQueue.length === 1 ? '' : 's'}
            </span>
            <span className="font-mono text-[11px]">PostgreSQL / PostGIS persistence verified</span>
          </div>
        </section>

        {/* Right Column: Tactical Map Shortcut & Operational Events (5 cols) */}
        <section className="lg:col-span-5 space-y-6">
          {/* Tactical Map Shortcut Card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">map</span>
                <h3 className="text-sm font-bold text-on-surface">Operations Map Preview</h3>
              </div>
              <Link
                className="text-xs font-semibold text-primary hover:underline"
                href="/operator/map"
              >
                Open Full GIS Map →
              </Link>
            </div>

            {/* Stylized Simulated Map Preview Box */}
            <div className="relative h-44 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center text-slate-400">
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, #38bdf8 1px, transparent 1px), linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              />
              <div className="z-10 text-center space-y-2 p-4">
                <span className="material-symbols-outlined text-sky-400 text-3xl">
                  location_searching
                </span>
                <div className="text-xs font-semibold text-slate-200">Sector 4 — Tactical Map</div>
                <p className="text-[11px] text-slate-400 max-w-xs">
                  {metrics.totalRequests} Distress reports • {resources.length} Craft staged
                </p>
                <Link
                  className="inline-block px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-bold hover:bg-primary-container transition-colors"
                  href="/operator/map"
                >
                  Launch Interactive Map
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Operational Events Summary Card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">radar</span>
                <h3 className="text-sm font-bold text-on-surface">Recent Operational Events</h3>
              </div>
              <div className="flex items-center gap-2">
                {dashboardData?.eventsStale && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/60 text-amber-300 border border-amber-600/40">
                    CACHED
                  </span>
                )}
                <Link
                  className="text-xs text-primary font-semibold hover:underline"
                  href="/operator/events"
                >
                  All Events ({recentEvents.length}) →
                </Link>
              </div>
            </div>

            {dashboardData?.eventsError && !dashboardData?.recentEvents ? (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                Failed to load operational events: {dashboardData.eventsError}
              </div>
            ) : recentEvents.length === 0 ? (
              <p className="text-xs text-on-surface-variant italic py-3 text-center">
                No recent operational events recorded yet.
              </p>
            ) : (
              <div className="space-y-2">
                {recentEvents.slice(0, 4).map((evt) => (
                  <div
                    className="p-2.5 rounded-lg bg-surface border border-outline-variant/30 text-xs flex items-center justify-between gap-2"
                    key={evt.id}
                  >
                    <div className="truncate">
                      <span className="font-bold text-on-surface block truncate">{evt.type}</span>
                      <span className="text-[10px] text-on-surface-variant font-mono truncate block">
                        {evt.entityType}: {evt.entityId}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-on-surface-variant shrink-0">
                      {new Date(evt.recordedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* LOWER SECTION: Resource Roster & Live Status Mutation Panel */}
      <ResourceStatusPanel
        error={resourcesError}
        isLoading={isLoading && dashboardData?.resources === null}
        isStale={resourcesStale}
        onResourceUpdated={() => void refresh()}
        resources={resources}
      />

      {/* Road Hazard Registration Modal */}
      <RoadBlockageModal
        isOpen={isRoadBlockageOpen}
        onClose={() => setIsRoadBlockageOpen(false)}
        onZoneCreated={() => void refresh()}
      />
    </div>
  );
}
