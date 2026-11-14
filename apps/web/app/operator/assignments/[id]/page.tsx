'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/ui/StatusBadge';
import { apiClient } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';
import type { AssignmentRecord } from '@/lib/api/types';
import RepairComparison from '@/components/operator/repair/RepairComparison';
import {
  formatDistanceKm,
  formatDurationMinutes,
  getRouteDisplayMetrics,
  getRouteSourceLabel,
  summarizeAssignmentRoutes,
} from '@/components/operator/map/routeDisplay';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AssignmentReviewPage({ params }: PageProps) {
  const resolvedParams = React.use(params);
  const planId = resolvedParams.id;
  const { operator } = useOperatorAuth();
  const canCommit = hasPermission(operator, 'COMMIT_ASSIGNMENT');

  const [plan, setPlan] = useState<AssignmentRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showRepairComparison, setShowRepairComparison] = useState<boolean>(false);

  // Interactive checklist states
  const [checklist, setChecklist] = useState({
    draftClearance: false,
    shelterCapacity: false,
    medicalProtocol: false,
  });

  const [showCommitModal, setShowCommitModal] = useState(false);
  const [operatorNotes, setOperatorNotes] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccessAlert, setCommitSuccessAlert] = useState<string | null>(null);

  const fetchAssignment = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiClient.getAssignment(planId);
      setPlan(data);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 404) {
          setError(`Assignment plan with ID "${planId}" not found in database.`);
        } else {
          setError(err.message);
        }
      } else {
        setError((err as Error).message || 'Failed to load assignment plan.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchAssignment();
  }, [fetchAssignment]);

  const handleCommitPlan = async () => {
    if (isCommitting || !plan) return;

    try {
      setIsCommitting(true);
      setCommitError(null);

      const opIdentifier = operator?.username || operator?.id || 'OPERATOR';
      const updated = await apiClient.commitAssignment(plan.id, {
        operatorId: opIdentifier,
        notes: operatorNotes.trim() || undefined,
      });

      setPlan(updated);
      setShowCommitModal(false);
      setCommitSuccessAlert(
        `Assignment plan ${plan.id} successfully committed! All route stops are now frozen and requests marked as ASSIGNED.`,
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (
          err.statusCode === 409 ||
          err.code === 'ALREADY_COMMITTED' ||
          err.code === 'VERSION_CONFLICT'
        ) {
          setCommitError(
            'Version Conflict (409): This assignment plan has already been committed or modified by another operator. Please refresh to load the latest state.',
          );
        } else if (err.code === 'REQUEST_ALREADY_ASSIGNED') {
          setCommitError(
            'One or more requests in this plan have already been assigned to another plan. Please generate a fresh proposal.',
          );
        } else if (err.code === 'SIMULATED_RESOURCE_FORBIDDEN') {
          setCommitError(
            'Operational Commitment Forbidden (409): Cannot commit an assignment plan containing simulated resources in operational dispatch mode. Ensure all plan assets are authentic registered operational vehicles.',
          );
        } else if (err.code === 'SIMULATED_REQUEST_FORBIDDEN') {
          setCommitError(
            'Operational Commitment Forbidden (409): Cannot commit an assignment plan containing simulated requests in operational dispatch mode. Operational plans must serve authentic reported requests.',
          );
        } else if (err.code === 'SIMULATED_SHELTER_FORBIDDEN') {
          setCommitError(
            'Operational Commitment Forbidden (409): Cannot commit an assignment plan containing simulated destination shelters in operational dispatch mode. Ensure all drop-off destinations are authentic registered emergency shelters.',
          );
        } else if (err.code === 'SHELTER_UNAVAILABLE') {
          setCommitError(`Shelter Unavailable (409): ${err.message}`);
        } else if (err.code === 'SHELTER_NOT_FOUND') {
          setCommitError(`Shelter Not Found (409): ${err.message}`);
        } else if (err.code === 'SHELTER_CAPACITY_EXCEEDED') {
          setCommitError(`Shelter Capacity Exceeded (409): ${err.message}`);
        } else if (err.code === 'RESOURCE_UNAVAILABLE') {
          setCommitError(`Resource Unavailable (409): ${err.message}`);
        } else if (err.code === 'RESOURCE_NOT_FOUND') {
          setCommitError(`Resource Not Found (409): ${err.message}`);
        } else {
          setCommitError(err.message);
        }
      } else {
        setCommitError((err as Error).message || 'Failed to commit assignment plan.');
      }
    } finally {
      setIsCommitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-12 text-center space-y-3">
        <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <h2 className="text-base font-bold text-slate-800 font-mono">
          Loading Assignment Plan {planId}...
        </h2>
        <p className="text-xs text-slate-500">Querying PostgreSQL/PostGIS database</p>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
        <div className="h-16 w-16 bg-red-100 text-red-700 rounded-full flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-3xl">search_off</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Assignment Plan Not Found</h1>
        <p className="text-sm text-slate-600">
          {error || `The requested plan ID "${planId}" does not exist in the database.`}
        </p>
        <div className="pt-2">
          <Link
            href="/operator/assignments"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>Return to Assignments List</span>
          </Link>
        </div>
      </div>
    );
  }

  const isProposed = plan.status === 'PROPOSED';
  const isSimulatedPlan =
    plan.provenance === 'SIMULATED' ||
    plan.provenance === 'MIXED' ||
    Boolean(plan.hasSimulatedResources) ||
    Boolean(plan.hasSimulatedRequests) ||
    Boolean(plan.hasSimulatedShelters) ||
    Boolean(plan.hasUnresolvedProvenance);

  const allChecked =
    checklist.draftClearance && checklist.shelterCapacity && checklist.medicalProtocol;
  const canCommitPlan = isProposed && allChecked && canCommit && !isSimulatedPlan;
  const routes = plan.routes || [];
  const unserved = plan.unserved || [];

  const createdDate = new Date(plan.created_at ?? plan.createdAt);
  const formattedCreated = !isNaN(createdDate.getTime())
    ? createdDate.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';

  const committedDate = plan.committed_at ?? plan.committedAt;
  const formattedCommitted = committedDate
    ? new Date(committedDate).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-slate-900 text-white rounded-xl p-3.5 sm:p-4 border border-slate-800 flex items-start gap-3 shadow-sm">
        <span className="material-symbols-outlined text-teal-400 text-xl shrink-0 mt-0.5">
          gavel
        </span>
        <div className="text-xs">
          <span className="font-bold text-teal-300">
            Human-Supervised Plan Authorization &amp; Commitment
          </span>
          <p className="text-slate-300 mt-0.5 leading-relaxed">
            Connected to Phase 2 REST API and PostgreSQL backend. Committing records an
            operator-approved assignment plan in the database.
            <strong className="text-amber-300">
              {' '}
              Committing records the decision; it does not dispatch physical crews or boats.
            </strong>
          </p>
        </div>
      </div>

      {commitSuccessAlert && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-950 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-700 text-lg">task_alt</span>
            <span className="font-bold">{commitSuccessAlert}</span>
          </div>
          <button
            type="button"
            onClick={() => setCommitSuccessAlert(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Breadcrumb Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Link
            href="/operator/assignments"
            className="flex items-center gap-1 text-teal-700 hover:text-teal-800 font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            <span>Assignments List</span>
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-600 font-mono">{plan.id}</span>
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-900">Plan Review &amp; Commitment</span>
        </div>
        <div className="text-slate-500 font-mono text-[11px]">
          Operator Session:{' '}
          <span className="font-bold text-slate-800">{operator?.username || 'Authenticated'}</span>
        </div>
      </div>

      {/* Proposal Banner & Primary Action Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <StatusBadge status={plan.status} />
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Created: {formattedCreated}
              </span>
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Scenario: {plan.scenario_id ?? plan.scenarioId ?? 'scenario-delhi-yamuna-demo'}
              </span>
              {isSimulatedPlan ? (
                <span className="text-xs font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">science</span>
                  <span>{plan.provenance === 'MIXED' ? 'MIXED PROVENANCE' : 'SIMULATED PLAN'}</span>
                </span>
              ) : (
                <span className="text-xs font-mono font-bold text-teal-900 bg-teal-100 px-2 py-0.5 rounded border border-teal-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">verified</span>
                  <span>REAL FLEET PLAN</span>
                </span>
              )}
              {plan.committed_by && (
                <span className="text-xs font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                  Committed by: {plan.committed_by} ({formattedCommitted})
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {plan.id}
            </h1>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex items-center gap-3">
            <Link
              href="/operator/assignments"
              className="h-9 px-3 rounded bg-slate-50 border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              <span>All Plans</span>
            </Link>

            <button
              type="button"
              onClick={() => setShowRepairComparison(!showRepairComparison)}
              className="h-9 px-3 rounded bg-teal-50 border border-teal-300 text-teal-800 hover:bg-teal-100 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <span className="material-symbols-outlined text-base">alt_route</span>
              <span>{showRepairComparison ? 'Hide Repair Comparison' : 'Compare Repair Plan'}</span>
            </button>

            {isProposed ? (
              <button
                type="button"
                disabled={!canCommitPlan}
                onClick={() => {
                  setCommitError(null);
                  setShowCommitModal(true);
                }}
                title={
                  !canCommit
                    ? 'Dispatcher or Admin authorization required to commit assignment plans'
                    : isSimulatedPlan
                      ? 'Operational commitment is disabled for plans incorporating simulated assets, synthetic requests, or test shelters'
                      : !allChecked
                        ? 'Complete all safety checklist items before committing'
                        : 'Commit assignment plan'
                }
                className={`h-9 px-4 rounded text-xs font-bold transition-all flex items-center gap-2 shadow-sm ${
                  canCommitPlan
                    ? 'bg-teal-700 hover:bg-teal-800 text-white ring-2 ring-teal-500/30'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <span className="material-symbols-outlined text-base">lock_open</span>
                <span>Commit Assignment Plan</span>
              </button>
            ) : (
              <div className="h-9 px-4 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-emerald-700">
                  verified
                </span>
                <span>Plan Committed &amp; Frozen</span>
              </div>
            )}
          </div>
        </div>

        {/* Simulation / Reference Plan Warning */}
        {isSimulatedPlan && (
          <div className="bg-amber-50 border-l-4 border-amber-600 rounded-r-lg p-3 sm:p-4 flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-700 text-2xl shrink-0 mt-0.5">
              warning
            </span>
            <div className="flex-1 text-xs">
              <div className="font-bold text-amber-900 flex items-center gap-2">
                <span>Simulation / Reference Plan</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-200 text-amber-900 border border-amber-300">
                  {plan.provenance ?? 'SIMULATED'}
                </span>
              </div>
              <p className="text-amber-800 mt-1 leading-relaxed">
                This plan incorporates simulated assets, synthetic requests, or test destination
                shelters. Operational commitment is disabled to prevent simulated data from
                contaminating live mission dispatch state. To execute an operational commitment,
                ensure all participating resources, requests, and destination shelters are verified
                authentic database entities.
              </p>
            </div>
          </div>
        )}

        {/* Human-in-the-Loop Safeguard Notice */}
        <div className="bg-slate-50 border-l-4 border-teal-700 rounded-r-lg p-3 sm:p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-teal-700 text-2xl shrink-0 mt-0.5">
            security
          </span>
          <div className="flex-1 text-xs">
            <div className="font-bold text-slate-900 flex items-center gap-2">
              <span>Human-in-the-Loop Supervisory Protocol</span>
              <span className="font-mono text-slate-500 font-normal">
                (Standard Incident Command §4.2)
              </span>
            </div>
            <p className="text-slate-600 mt-1 leading-relaxed">
              {isProposed ? (
                <>
                  This proposed plan is generated by the VRP solver and requires human verification
                  prior to database commitment. Complete the safety checklist below and click{' '}
                  <strong>Commit Assignment Plan</strong> to freeze all stops and mark requests as
                  ASSIGNED.
                </>
              ) : (
                <>
                  This plan is <strong>COMMITTED</strong>. All stops are frozen against modification
                  in the PostGIS database. Request records have been locked into ASSIGNED status.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Repair Comparison Section */}
      {showRepairComparison && (
        <section className="animate-in fade-in duration-200">
          <RepairComparison
            baselinePlan={
              plan
                ? {
                    scenarioId: plan.scenario_id ?? plan.scenarioId ?? 'baseline',
                    calculatedAt: plan.created_at ?? plan.createdAt,
                    routes: plan.routes || [],
                    unserved: plan.unserved || [],
                    metrics: plan.metrics || {
                      coveragePercent: 80,
                      totalTravelTimeMinutes: 100,
                      totalTravelDistanceKm: 30,
                      highPriorityWaitTimeMinutes: 20,
                      solveDurationMs: 300,
                      servedRequestsCount: (plan.routes || []).reduce(
                        (acc, r) => acc + (r.servedRequestIds?.length || 0),
                        0,
                      ),
                      unservedRequestsCount: (plan.unserved || []).length,
                    },
                  }
                : null
            }
            isSolverUnavailable={true}
            isSimulated={true}
            onClose={() => setShowRepairComparison(false)}
          />
        </section>
      )}

      {/* Two-Column Detailed Review Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* ===================================================================== */}
        {/* LEFT COLUMN: Vehicle Routes & Manifest (7/12 cols)                   */}
        {/* ===================================================================== */}
        <div className="xl:col-span-7 space-y-6">
          {/* Multi-vehicle routes */}
          {routes.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
              <span className="material-symbols-outlined text-3xl text-slate-400">
                directions_boat
              </span>
              <h3 className="text-sm font-bold text-slate-900">No Vehicle Routes Generated</h3>
              <p className="text-xs text-slate-500">
                The solver did not generate any vehicle routes for this plan.
              </p>
            </div>
          ) : (
            routes.map((route, routeIdx) => {
              const routeMetrics = getRouteDisplayMetrics(route);
              const sourceBadgeClass =
                routeMetrics.source === 'OSRM'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : routeMetrics.source === 'MIXED'
                    ? 'bg-sky-50 text-sky-800 border-sky-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200';

              return (
                <article
                  key={route.resourceId || routeIdx}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                >
                  {/* Header Bar */}
                  <div className="bg-slate-50 border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <span className="p-1 rounded bg-teal-700 text-white">
                        <span className="material-symbols-outlined text-lg">sailing</span>
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-sm font-bold text-slate-900">
                            Craft: {route.resourceId}
                          </h2>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-teal-100 text-teal-800 font-bold border border-teal-200">
                            Route #{routeIdx + 1}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${sourceBadgeClass}`}
                          >
                            {getRouteSourceLabel(routeMetrics.source)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {routeMetrics.pickupsCount} Pickups • {routeMetrics.dropoffsCount}{' '}
                          Drop-offs • {routeMetrics.stopsCount} Total Stops
                        </div>
                      </div>
                    </div>

                    {/* Distance / Duration Route Metrics */}
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">
                          Distance
                        </div>
                        <div className="text-xs font-bold text-slate-900 font-mono">
                          {formatDistanceKm(routeMetrics.distanceKm)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">
                          Est. Duration
                        </div>
                        <div className="text-xs font-bold text-slate-900 font-mono">
                          {formatDurationMinutes(routeMetrics.durationMinutes)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Ordered Route Stops Timeline */}
                  <div className="p-4 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-xs uppercase font-mono tracking-wider text-slate-500 font-semibold">
                        Ordered Navigation Sequence
                      </span>
                      <span className="text-xs font-mono text-teal-700 font-semibold flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">route</span>
                        Sequential Solution
                      </span>
                    </div>

                    <div className="relative pl-6 space-y-3 before:absolute before:left-[11px] before:top-2 before:bottom-3 before:w-0.5 before:bg-slate-200">
                      {route.stops.map((stop) => {
                        const isDepot = stop.type === 'DEPOT';
                        const isPickup = stop.type === 'PICKUP';
                        const isDropoff = stop.type === 'DROPOFF';

                        let badgeColor = 'bg-slate-200 text-slate-700';
                        if (isPickup) badgeColor = 'bg-teal-100 text-teal-800 border-teal-200';
                        if (isDropoff)
                          badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';

                        let ringColor = 'bg-slate-700';
                        if (isPickup) ringColor = 'bg-teal-700';
                        if (isDropoff) ringColor = 'bg-emerald-700';

                        return (
                          <div
                            key={`${stop.targetId}-${stop.stopNumber}`}
                            className="relative flex items-start gap-3"
                          >
                            <div
                              className={`absolute -left-6 mt-1 w-5 h-5 rounded-full ${ringColor} text-white flex items-center justify-center text-[10px] font-bold ring-4 ring-white`}
                            >
                              {stop.stopNumber}
                            </div>
                            <div
                              className={`flex-1 rounded p-2.5 border text-xs ${
                                isPickup
                                  ? 'bg-white border-teal-200 shadow-2xs'
                                  : isDropoff
                                    ? 'bg-emerald-50/50 border-emerald-200'
                                    : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-slate-500">
                                    [+{Math.round(stop.estimatedArrivalMinutes)}m]
                                  </span>
                                  <span className="font-bold text-slate-900">
                                    {isDepot && `Depot: ${stop.targetId || 'Launch Point'}`}
                                    {isPickup && `Pickup: Request #${stop.targetId}`}
                                    {isDropoff && `Shelter: ${stop.targetId || 'Safe Shelter'}`}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${badgeColor}`}
                                  >
                                    {stop.type}
                                  </span>
                                  {stop.isFrozen && (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-100 text-blue-800 font-semibold">
                                      Frozen
                                    </span>
                                  )}
                                </div>
                                <div className="text-right text-[11px] font-mono">
                                  {stop.passengersPickedUp > 0 && (
                                    <span className="font-bold text-teal-700">
                                      +{stop.passengersPickedUp} pax
                                    </span>
                                  )}
                                  {stop.passengersDroppedOff > 0 && (
                                    <span className="font-bold text-emerald-800">
                                      -{stop.passengersDroppedOff} pax safe
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })
          )}

          {/* Unserved Incidents Warning Box */}
          {unserved.length > 0 ? (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-start gap-3 shadow-xs">
              <span className="material-symbols-outlined text-2xl text-amber-700 shrink-0 mt-0.5">
                warning
              </span>
              <div className="flex-1 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-amber-950 text-sm">
                    {unserved.length} Request(s) Excluded by Solver: Resource Scaling Required
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 uppercase font-mono">
                    Attention
                  </span>
                </div>
                <p className="text-amber-900 leading-relaxed">
                  The automated VRP algorithm excluded these locations due to craft capacity, shift
                  limits, or boundary constraints. These cases remain in the pending intake queue
                  for subsequent waves:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  {unserved.map((item, idx) => (
                    <div
                      key={item.requestId || idx}
                      className="bg-white/80 border border-amber-200 rounded p-2 text-slate-800"
                    >
                      <span className="font-bold font-mono">#{item.requestId}</span> —{' '}
                      <span className="text-amber-800 font-semibold">{item.reason}</span>
                      {item.details && (
                        <div className="text-[11px] text-slate-500 mt-0.5">{item.details}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-center gap-3 text-xs text-emerald-950">
              <span className="material-symbols-outlined text-emerald-700 text-2xl shrink-0">
                check_circle
              </span>
              <div>
                <span className="font-bold text-emerald-900">
                  Optimal Feasibility: Zero Unserved Requests
                </span>
                <p className="text-emerald-800 mt-0.5">
                  All eligible pending requests were successfully allocated across the fleet within
                  craft capacity and shift time constraints.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ===================================================================== */}
        {/* RIGHT COLUMN: Topology Map, Checklist, Commit Trigger (5/12 cols)     */}
        {/* ===================================================================== */}
        <div className="xl:col-span-5 space-y-6">
          {/* Geospatial Routing Topology Panel */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <span className="material-symbols-outlined text-teal-700 text-base">hub</span>
                <span>Tactical Topology</span>
              </div>
              <span className="text-[11px] font-mono text-emerald-700 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Plan Solution
              </span>
            </div>

            {/* Tactical Vector Map Canvas */}
            <div className="relative w-full h-64 bg-slate-900 overflow-hidden">
              <svg className="w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="tacticalGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path
                      d="M 20 0 L 0 0 0 20"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.05)"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#tacticalGrid)" />

                {/* Simulated bayou curve */}
                <path
                  d="M -20,160 C 120,150 220,190 320,170 C 420,150 520,170 600,150"
                  fill="none"
                  stroke="#007a71"
                  strokeWidth="12"
                  opacity="0.8"
                />

                {/* Navigational Vector Path */}
                <polyline
                  points="60,170 140,150 220,130 360,80"
                  fill="none"
                  stroke="#80d5cb"
                  strokeWidth="3"
                  strokeDasharray="4,4"
                />

                {/* Nodes */}
                <circle cx="60" cy="170" r="5" fill="#334155" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx="140" cy="150" r="6" fill="#dc2626" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx="220" cy="130" r="6" fill="#d97706" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx="360" cy="80" r="7" fill="#0f766e" stroke="#ffffff" strokeWidth="1.5" />
              </svg>

              {/* Overlay HUD */}
              <div className="absolute inset-0 p-3 flex flex-col justify-between pointer-events-none text-xs">
                <div className="flex items-center justify-between">
                  <span className="bg-slate-900/90 text-teal-300 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-700">
                    Plan: {plan.id}
                  </span>
                  <span className="bg-slate-900/90 text-slate-300 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-700">
                    Status: {plan.status}
                  </span>
                </div>
                <div className="bg-slate-900/95 text-slate-200 border border-slate-700 p-2 rounded text-[11px] font-mono max-w-[320px]">
                  {(() => {
                    const summary = summarizeAssignmentRoutes(routes);
                    const totalKm =
                      summary.totalDistanceKm > 0
                        ? summary.totalDistanceKm
                        : (plan.metrics?.totalTravelDistanceKm ?? 0);
                    return (
                      <>
                        <div className="font-bold text-teal-300">
                          {routes.length} Route(s) • {plan.metrics?.servedRequestsCount ?? 0}{' '}
                          Requests Allocated ({getRouteSourceLabel(summary.overallSource)})
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Dist: {formatDistanceKm(totalKm)} | Travel: ~
                          {Math.round(
                            plan.metrics?.totalTravelTimeMinutes ?? summary.totalDurationMinutes,
                          )}
                          m | Wait: ~{Math.round(plan.metrics?.highPriorityWaitTimeMinutes ?? 0)}m
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-around text-[11px] font-mono text-slate-600">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-700 inline-block" /> Depot
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-teal-600 inline-block" /> Pickups
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" /> Shelters
              </span>
            </div>
          </div>

          {/* Safety & Conflict Checklist */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-teal-700 text-xl">
                  verified_user
                </span>
                <h3 className="text-sm font-bold text-slate-900">
                  Safety &amp; Conflict Checklist
                </h3>
              </div>
              <span className="text-[10px] font-mono text-teal-800 bg-teal-100 px-2 py-0.5 rounded font-bold uppercase">
                Required Verification
              </span>
            </div>

            <p className="text-xs text-slate-600">
              Each operational constraint must be acknowledged by the operator before committing the
              assignment plan to the database:
            </p>

            <div className="space-y-2 pt-1 text-xs">
              {/* Checklist Item 1 */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  disabled={!isProposed}
                  checked={checklist.draftClearance || !isProposed}
                  onChange={(e) =>
                    setChecklist((prev) => ({ ...prev, draftClearance: e.target.checked }))
                  }
                  className="mt-0.5 rounded text-teal-700 focus:ring-teal-700 border-slate-300 cursor-pointer"
                />
                <div>
                  <span className="font-bold text-slate-900">
                    [✓] Craft draft clearances and navigational water depth verified
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Confirmed safe channel access along allocated pickup and offload paths.
                  </p>
                </div>
              </label>

              {/* Checklist Item 2 */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  disabled={!isProposed}
                  checked={checklist.shelterCapacity || !isProposed}
                  onChange={(e) =>
                    setChecklist((prev) => ({ ...prev, shelterCapacity: e.target.checked }))
                  }
                  className="mt-0.5 rounded text-teal-700 focus:ring-teal-700 border-slate-300 cursor-pointer"
                />
                <div>
                  <span className="font-bold text-slate-900">
                    [✓] Receiving shelter intake capacity and staffing confirmed
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Shelter liaison verified capacity to receive planned incoming evacuees.
                  </p>
                </div>
              </label>

              {/* Checklist Item 3 */}
              <label className="flex items-start gap-2.5 p-2 rounded bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  disabled={!isProposed}
                  checked={checklist.medicalProtocol || !isProposed}
                  onChange={(e) =>
                    setChecklist((prev) => ({ ...prev, medicalProtocol: e.target.checked }))
                  }
                  className="mt-0.5 rounded text-teal-700 focus:ring-teal-700 border-slate-300 cursor-pointer"
                />
                <div>
                  <span className="font-bold text-slate-900">
                    [✓] Special medical assistance &amp; oxygen protocols verified
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Critical medical needs matched with appropriate craft equipment and paramedic
                    crews.
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* Pre-Commit Authorization Box */}
          <section className="bg-white border-2 border-teal-700 rounded-xl p-4 sm:p-5 shadow-md space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <span className="p-1 rounded bg-teal-700 text-white">
                <span className="material-symbols-outlined text-lg">lock</span>
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isProposed ? 'Commit Plan to Database' : 'Plan Committed'}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {isProposed
                    ? 'Irrevocable database commit & freeze'
                    : 'Stored & Frozen in PostGIS'}
                </p>
              </div>
            </div>

            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 leading-relaxed">
              {isProposed ? (
                <>
                  Committing will record this assignment plan in PostgreSQL, freeze all route stops,
                  lock assigned requests to <strong>ASSIGNED</strong>, and generate an audit log
                  entry.
                </>
              ) : (
                <>
                  This plan is officially committed. Recorded by{' '}
                  <strong className="text-slate-900">{plan.committed_by || 'Operator'}</strong> at{' '}
                  {formattedCommitted}.
                </>
              )}
            </div>

            {isProposed ? (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={!allChecked}
                  onClick={() => {
                    setCommitError(null);
                    setShowCommitModal(true);
                  }}
                  className={`w-full h-10 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 ${
                    allChecked
                      ? 'bg-teal-700 hover:bg-teal-800 text-white ring-2 ring-teal-500/30 active:scale-[0.99]'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">lock_open</span>
                  <span>Confirm &amp; Commit Assignment Plan</span>
                </button>
                {!allChecked && (
                  <p className="text-[11px] text-amber-700 text-center font-medium">
                    Acknowledge all 3 checklist safety items before committing.
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center space-y-1">
                <div className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-700 text-base">
                    task_alt
                  </span>
                  <span>Plan Committed &amp; Frozen</span>
                </div>
                <p className="text-[11px] text-emerald-800 font-mono">
                  PostGIS state verified at {formattedCommitted}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Real Commit Confirmation Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center gap-3 text-teal-700 border-b border-slate-200 pb-3">
              <span className="material-symbols-outlined text-3xl">verified_user</span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Commit Assignment Plan</h3>
                <p className="text-xs text-slate-500 font-mono">Plan ID: {plan.id}</p>
              </div>
            </div>

            {commitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <span className="material-symbols-outlined text-base shrink-0 mt-0.5">error</span>
                <div>
                  <span className="font-bold">Commit Failed: </span>
                  {commitError}
                </div>
              </div>
            )}

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-2">
              <p className="font-bold flex items-center gap-1.5 text-amber-900">
                <span className="material-symbols-outlined text-amber-700 text-base">info</span>
                Operational Notice: Decision Record Commitment
              </p>
              <p className="leading-relaxed">
                Committing records this assignment as an operator-approved decision plan in
                PostgreSQL. All {routes.length} vehicle route stops will be permanently frozen and
                assigned requests will transition to ASSIGNED status.
              </p>
              <p className="text-slate-700 font-semibold text-[11px]">
                * Committing records the administrative allocation decision. It does NOT
                automatically dispatch physical rescue crews or launch boats.
              </p>
            </div>

            {/* Operator Notes Input */}
            <div className="space-y-1">
              <label
                htmlFor="operator-notes"
                className="block text-xs font-bold text-slate-800 font-mono"
              >
                Operator Audit Notes (Optional)
              </label>
              <textarea
                id="operator-notes"
                rows={2}
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                placeholder="e.g. Verified water depths and shelter staffing for Yamuna Sector"
                className="w-full rounded border border-slate-300 bg-white p-2 text-xs text-slate-800 focus:ring-1 focus:ring-teal-700 focus:border-teal-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowCommitModal(false)}
                disabled={isCommitting}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitPlan}
                disabled={isCommitting}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                  isCommitting
                    ? 'bg-teal-400 text-white cursor-not-allowed'
                    : 'bg-teal-700 hover:bg-teal-800 text-white'
                }`}
              >
                {isCommitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Committing Transaction...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">lock</span>
                    <span>Confirm &amp; Commit Plan</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
