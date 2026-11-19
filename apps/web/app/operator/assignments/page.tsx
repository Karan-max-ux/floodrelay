'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatRegionDateTime } from '@/lib/region';
import StatusBadge from '@/components/ui/StatusBadge';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { apiClient } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/errors';
import type { AssignmentRecord, ProposeAssignmentInput } from '@/lib/api/types';
import type { RescueRequest } from '@floodrelay/shared';

function OperatorAssignmentsContent() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get('requestId');

  const [verifiedRequest, setVerifiedRequest] = useState<RescueRequest | null>(null);
  const [isVerifyingRequest, setIsVerifyingRequest] = useState<boolean>(Boolean(requestId));
  const [requestVerificationError, setRequestVerificationError] = useState<string | null>(null);

  const [plans, setPlans] = useState<AssignmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [filterTab, setFilterTab] = useState<'ALL' | 'PROPOSED' | 'COMMITTED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Retrieve selected request from existing API to verify urgency, passenger count and eligibility
  useEffect(() => {
    if (!requestId) {
      setVerifiedRequest(null);
      setRequestVerificationError(null);
      setIsVerifyingRequest(false);
      return;
    }

    const currentRequestId = requestId;
    let isMounted = true;
    async function verifyRequest() {
      setIsVerifyingRequest(true);
      setRequestVerificationError(null);
      try {
        const req = await apiClient.getRequest(currentRequestId);
        if (isMounted) {
          setVerifiedRequest(req);
        }
      } catch (err) {
        if (isMounted) {
          setVerifiedRequest(null);
          if (err instanceof ApiClientError && err.statusCode === 404) {
            setRequestVerificationError(
              `Request #${requestId} was not found in the operational database. It may be invalid or deleted.`,
            );
          } else {
            setRequestVerificationError(
              (err as Error).message || `Unable to verify request #${requestId} with database.`,
            );
          }
        }
      } finally {
        if (isMounted) {
          setIsVerifyingRequest(false);
        }
      }
    }

    verifyRequest();
    return () => {
      isMounted = false;
    };
  }, [requestId]);

  // Determine if verified request is eligible for scenario-wide VRP solver planning
  const eligibility = useMemo(() => {
    if (!verifiedRequest) {
      return {
        isEligible: false,
        reason: 'UNVERIFIED',
        badgeText: 'UNVERIFIED',
        description: isVerifyingRequest
          ? 'Verifying request status with operational database...'
          : 'Waiting for database verification...',
      };
    }

    if (verifiedRequest.isFlaggedDuplicate) {
      return {
        isEligible: false,
        reason: 'DUPLICATE',
        badgeText: 'INELIGIBLE: DUPLICATE',
        description: `Flagged as duplicate distress incident${verifiedRequest.duplicateOfId ? ` of #${verifiedRequest.duplicateOfId}` : ''}. Solver excludes duplicate calls.`,
      };
    }

    if (verifiedRequest.status === 'ASSIGNED') {
      return {
        isEligible: false,
        reason: 'ASSIGNED',
        badgeText: 'INELIGIBLE: ALREADY ASSIGNED',
        description:
          'Incident has already been assigned to an active rescue craft in a committed mission plan.',
      };
    }

    if (verifiedRequest.status === 'IN_TRANSIT') {
      return {
        isEligible: false,
        reason: 'IN_TRANSIT',
        badgeText: 'INELIGIBLE: IN TRANSIT',
        description: 'Rescue craft is currently en route to this incident location.',
      };
    }

    if (verifiedRequest.status === 'RESCUED') {
      return {
        isEligible: false,
        reason: 'RESCUED',
        badgeText: 'INELIGIBLE: RESCUED',
        description: 'Rescue mission has already been successfully completed for this incident.',
      };
    }

    if (verifiedRequest.status === 'CANCELLED') {
      return {
        isEligible: false,
        reason: 'CANCELLED',
        badgeText: 'INELIGIBLE: CANCELLED',
        description: 'This distress call was cancelled and is closed for dispatch.',
      };
    }

    if (verifiedRequest.status === 'PENDING') {
      return {
        isEligible: true,
        reason: 'PENDING_ELIGIBLE',
        badgeText: 'VERIFIED • ELIGIBLE FOR PLANNING',
        description:
          'Pending distress call verified in database. Ready for scenario-wide VRP optimization.',
      };
    }

    return {
      isEligible: false,
      reason: 'UNKNOWN',
      badgeText: `INELIGIBLE: ${verifiedRequest.status}`,
      description: `Current status is ${verifiedRequest.status}.`,
    };
  }, [verifiedRequest, isVerifyingRequest]);

  // When requestId is present, proposal generation strictly requires successful verification and isEligible === true.
  // When no requestId is present, normal scenario-wide planning is preserved without request verification.
  const isPlanningAllowed = useMemo(() => {
    if (!requestId) return true;
    if (isVerifyingRequest || requestVerificationError || !verifiedRequest) return false;
    return eligibility.isEligible;
  }, [
    requestId,
    isVerifyingRequest,
    requestVerificationError,
    verifiedRequest,
    eligibility.isEligible,
  ]);

  const planningDisabledReason = useMemo(() => {
    if (!requestId || isPlanningAllowed) return null;
    if (isVerifyingRequest) {
      return `Verifying focused request #${requestId} against operational database...`;
    }
    if (requestVerificationError) {
      return requestVerificationError;
    }
    if (!verifiedRequest) {
      return `Focused request #${requestId} could not be verified in the operational database.`;
    }
    if (!eligibility.isEligible) {
      return `Focused request #${requestId} is not eligible for new planning (${eligibility.reason}): ${eligibility.description}`;
    }
    return 'Proposal generation is disabled for this focused request context.';
  }, [
    requestId,
    isPlanningAllowed,
    isVerifyingRequest,
    requestVerificationError,
    verifiedRequest,
    eligibility,
  ]);

  // Proposal modal form state
  const [algorithm, setAlgorithm] = useState<'cluster-allocation' | 'nearest-first' | 'savings'>(
    'cluster-allocation',
  );
  const [scenarioId, setScenarioId] = useState('scenario-delhi-yamuna-demo');
  const [maxShiftMinutes, setMaxShiftMinutes] = useState(480);
  const [preserveFrozen, setPreserveFrozen] = useState(true);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [newlyCreatedPlanId, setNewlyCreatedPlanId] = useState<string | null>(null);
  const [lastGeneratedPlan, setLastGeneratedPlan] = useState<AssignmentRecord | null>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiClient.listAssignments();
      setPlans(data || []);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError((err as Error).message || 'Failed to load assignment plans from database.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleGenerateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingProposal) return;

    // Guard 1: Must be allowed by current client context
    if (!isPlanningAllowed) {
      setProposalError(
        planningDisabledReason ||
          'Cannot generate solver proposal: focused request context is ineligible or unverified.',
      );
      return;
    }

    try {
      setIsSubmittingProposal(true);
      setProposalError(null);

      // Guard 2: Recheck focused request latest database status immediately before submission
      if (requestId) {
        let freshRequest: RescueRequest;
        try {
          freshRequest = await apiClient.getRequest(requestId);
        } catch (freshErr) {
          const is404 =
            (freshErr instanceof ApiClientError &&
              (freshErr.statusCode === 404 || freshErr.isNotFound)) ||
            (freshErr as { statusCode?: number }).statusCode === 404;
          const errMsg = is404
            ? `Focused request #${requestId} was not found in database (it may have been deleted or cancelled).`
            : (freshErr as Error).message ||
              `Failed to re-verify request #${requestId} before solver run.`;
          setVerifiedRequest(null);
          setRequestVerificationError(errMsg);
          setProposalError(`Pre-dispatch verification check failed: ${errMsg}`);
          return;
        }

        // Keep local state synchronized with database
        setVerifiedRequest(freshRequest);

        if (freshRequest.isFlaggedDuplicate) {
          setProposalError(
            `Incident #${requestId} was flagged as duplicate${
              freshRequest.duplicateOfId ? ` of #${freshRequest.duplicateOfId}` : ''
            }. Proposal generation blocked.`,
          );
          return;
        }

        if (freshRequest.status !== 'PENDING') {
          setProposalError(
            `Incident #${requestId} is no longer pending (current database status: ${freshRequest.status}). Proposal generation blocked to prevent stale assignment.`,
          );
          return;
        }
      }

      const input: ProposeAssignmentInput = {
        algorithm,
        scenarioId: scenarioId.trim() || 'scenario-delhi-yamuna-demo',
        maxShiftMinutes: Number(maxShiftMinutes) || 480,
        preserveFrozen,
        includeUnverified,
      };

      const result = await apiClient.proposeAssignment(input);
      setNewlyCreatedPlanId(result.id);
      setLastGeneratedPlan(result);
      await fetchAssignments();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setProposalError(err.message);
      } else {
        setProposalError((err as Error).message || 'Failed to generate solver proposal.');
      }
    } finally {
      setIsSubmittingProposal(false);
    }
  };

  // Inspect whether the selected/focused request was served in the newly generated proposal
  const requestInclusionResult = useMemo(() => {
    if (!requestId || !lastGeneratedPlan) return null;

    for (const route of lastGeneratedPlan.routes || []) {
      if (route.servedRequestIds?.includes(requestId)) {
        return {
          status: 'SERVED' as const,
          resourceId: route.resourceId,
          message: `Request #${requestId} was included in proposed routes for Craft "${route.resourceId}".`,
        };
      }
      const stop = route.stops?.find((s) => s.targetId === requestId && s.type === 'PICKUP');
      if (stop) {
        return {
          status: 'SERVED' as const,
          resourceId: route.resourceId,
          message: `Request #${requestId} was included in proposed routes for Craft "${route.resourceId}" (Stop #${stop.stopNumber}).`,
        };
      }
    }

    const isUnserved = lastGeneratedPlan.unserved?.some(
      (u) =>
        (typeof u === 'string' && u === requestId) ||
        (typeof u === 'object' && u !== null && 'requestId' in u && u.requestId === requestId),
    );

    if (isUnserved) {
      return {
        status: 'UNSERVED' as const,
        message: `Request #${requestId} could not be served under the current scenario constraints (craft capacity or shift limits).`,
      };
    }

    return {
      status: 'NOT_IN_SCENARIO' as const,
      message: `Request #${requestId} was not included in active scenario "${lastGeneratedPlan.scenarioId || scenarioId}".`,
    };
  }, [requestId, lastGeneratedPlan, scenarioId]);

  const filteredPlans = plans.filter((plan) => {
    if (filterTab !== 'ALL' && plan.status !== filterTab) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = plan.id.toLowerCase().includes(q);
      const matchScenario = (plan.scenario_id ?? plan.scenarioId ?? '').toLowerCase().includes(q);
      const matchTitle = (plan.title ?? '').toLowerCase().includes(q);
      if (!matchId && !matchScenario && !matchTitle) return false;
    }
    return true;
  });

  const proposedCount = plans.filter((p) => p.status === 'PROPOSED').length;
  const committedCount = plans.filter((p) => p.status === 'COMMITTED').length;
  const totalUnservedCount = plans.reduce((acc, p) => acc + (p.unserved?.length ?? 0), 0);
  const totalServedRequests = plans.reduce(
    (acc, p) => acc + (p.metrics?.servedRequestsCount ?? 0),
    0,
  );

  return (
    <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-slate-900 text-white rounded-xl p-3.5 sm:p-4 border border-slate-800 flex items-start gap-3 shadow-xs">
        <span className="material-symbols-outlined text-teal-400 text-xl shrink-0 mt-0.5">
          verified_user
        </span>
        <div className="text-xs">
          <span className="font-bold text-teal-300">Live PostGIS &amp; Solver Integration</span>
          <p className="text-slate-300 mt-0.5 leading-relaxed">
            Connected to real PostgreSQL/PostGIS database. VRP solver generates mathematical
            allocation proposals. Committing records an operator-approved plan in the database; it
            does not initiate physical boat dispatch.
          </p>
        </div>
      </div>

      {/* Focused Request Context Banner (When navigated from Requests) */}
      {requestId && (
        <>
          {isVerifyingRequest ? (
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex items-center gap-3 text-xs text-slate-600">
              <span className="w-4 h-4 border-2 border-[#0066CC]/30 border-t-[#0066CC] rounded-full animate-spin shrink-0" />
              <span className="font-mono">
                Verifying request #{requestId} against operational database...
              </span>
            </div>
          ) : requestVerificationError ? (
            <div className="bg-amber-50/80 border-2 border-amber-300 rounded-xl p-4 sm:p-5 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-700 text-lg">warning</span>
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-900">
                    Unverified or Missing Request Context (#{requestId})
                  </span>
                </div>
                <Link
                  href="/operator/assignments"
                  className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 font-semibold"
                  title="Clear focused request context"
                >
                  <span>Clear Context</span>
                  <span className="material-symbols-outlined text-base">close</span>
                </Link>
              </div>
              <div className="text-xs text-amber-900 leading-relaxed space-y-1">
                <p className="font-semibold text-amber-800">{requestVerificationError}</p>
                <p className="text-amber-700">
                  URL query parameters cannot be verified against the operational database.
                  Scenario-wide solver proposals will only evaluate valid pending requests persisted
                  in PostgreSQL.
                </p>
              </div>
            </div>
          ) : verifiedRequest ? (
            <div
              className={`bg-white border-2 ${
                eligibility.isEligible ? 'border-[#0066CC]' : 'border-amber-400'
              } rounded-xl p-4 sm:p-5 shadow-xs space-y-3`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      eligibility.isEligible ? 'bg-[#0066CC] animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0066CC]">
                    Focused Request Planning Context
                  </span>
                  <span
                    className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded border ${
                      eligibility.isEligible
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                    }`}
                  >
                    {eligibility.badgeText}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold bg-slate-100 px-2.5 py-1 rounded text-slate-800">
                    #{verifiedRequest.id}
                  </span>
                  <UrgencyBadge urgency={verifiedRequest.urgency} />
                  <span className="text-xs font-bold font-mono text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                    {verifiedRequest.peopleCount}{' '}
                    {verifiedRequest.peopleCount === 1 ? 'Person' : 'People'}
                  </span>
                  <StatusBadge status={verifiedRequest.status || 'PENDING'} />
                  <Link
                    href="/operator/assignments"
                    className="text-xs text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors ml-2"
                    title="Clear focused request context"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </Link>
                </div>
              </div>

              {!eligibility.isEligible && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-base shrink-0 mt-0.5">
                    info
                  </span>
                  <div className="flex-1">
                    <span className="font-bold block">
                      Incident Ineligible for New Proposal Allocation
                    </span>
                    <span>
                      {eligibility.description} Scenario-wide solver proposals only allocate PENDING
                      distress incidents.
                    </span>
                  </div>
                  <Link
                    href="/operator/assignments"
                    className="text-xs bg-white border border-amber-300 text-amber-900 font-semibold px-2.5 py-1 rounded hover:bg-amber-100 shrink-0 self-center transition-colors"
                    title="Clear focused request context to return to unrestricted scenario-wide planning"
                  >
                    Clear Context
                  </Link>
                </div>
              )}

              <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <p>
                  <strong>Scenario-Wide VRP Optimization:</strong> The FloodRelay deterministic
                  solver evaluates all eligible pending requests across the operational scenario.
                  Generating a proposal optimizes fleet tours across the entire basin; it does not
                  assign only this single request in isolation.
                </p>
                {verifiedRequest.notes && (
                  <p className="text-[11px] text-slate-500 italic">
                    Distress Notes: &ldquo;{verifiedRequest.notes}&rdquo;
                  </p>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500 font-mono">
                  Active Scenario: <strong>{scenarioId}</strong> • Shift Limit:{' '}
                  <strong>{maxShiftMinutes}m</strong>
                </span>
                <button
                  type="button"
                  disabled={!isPlanningAllowed}
                  onClick={() => {
                    if (!isPlanningAllowed) return;
                    setNewlyCreatedPlanId(null);
                    setProposalError(null);
                    setShowGenerateModal(true);
                  }}
                  className={`h-8 px-4 rounded text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-xs ${
                    isPlanningAllowed
                      ? 'bg-[#0066CC] hover:bg-[#0055b3]'
                      : 'bg-slate-400 cursor-not-allowed opacity-60'
                  }`}
                  title={
                    isPlanningAllowed
                      ? 'Configure and run solver'
                      : planningDisabledReason || 'Incident is not eligible for new planning'
                  }
                >
                  <span className="material-symbols-outlined text-base">psychology</span>
                  <span>Configure &amp; Generate Solver Proposal</span>
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Header and Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Rescue Resource Assignments &amp; Solver Proposals
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Human-supervised fleet allocation. Distinct separation between automated solver
            proposals and human-committed field plans.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={fetchAssignments}
            disabled={isLoading}
            className="h-9 px-3 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-white transition-colors"
            title="Refresh assignment plans from database"
          >
            <span
              className={`material-symbols-outlined text-base ${isLoading ? 'animate-spin' : ''}`}
            >
              refresh
            </span>
            <span>Refresh</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isPlanningAllowed}
              onClick={() => {
                if (!isPlanningAllowed) return;
                setNewlyCreatedPlanId(null);
                setProposalError(null);
                setShowGenerateModal(true);
              }}
              className={`h-9 px-4 rounded text-xs font-bold transition-colors flex items-center gap-1.5 shadow-xs ${
                isPlanningAllowed
                  ? 'bg-[#0066CC] hover:bg-[#0055b3] text-white'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-75'
              }`}
              title={
                isPlanningAllowed
                  ? 'Generate new solver proposal'
                  : planningDisabledReason ||
                    'Planning disabled while focused request is ineligible'
              }
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              <span>[+] Generate New VRP Solver Proposal</span>
            </button>
            {!isPlanningAllowed && (
              <Link
                href="/operator/assignments"
                className="h-9 px-3 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="Clear focused request context to return to unrestricted scenario-wide planning"
              >
                <span>Clear Context</span>
                <span className="material-symbols-outlined text-sm">close</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Metric 1: Active Committed Plans */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between border-l-4 border-l-teal-600">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs uppercase font-mono tracking-wider font-semibold">
              Active Committed Plans
            </span>
            <span className="material-symbols-outlined text-teal-700 text-xl">directions_boat</span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-slate-900">
              {committedCount}{' '}
              <span className="text-sm text-slate-500 font-normal">Committed Plans</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Operator-approved allocation decisions stored in PostGIS
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
            <span className="text-teal-700 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Database Synced
            </span>
            <span className="text-slate-400">PostGIS Stored</span>
          </div>
        </div>

        {/* Metric 2: Pending Solver Proposals */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs uppercase font-mono tracking-wider font-semibold">
              Pending Solver Proposals
            </span>
            <span className="material-symbols-outlined text-amber-600 text-xl">psychology</span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-amber-700">
              {proposedCount}{' '}
              <span className="text-sm text-slate-500 font-normal">Pending Review</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Awaiting operator review and formal commitment
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
            <span className="text-amber-800 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
              {proposedCount > 0 ? 'Action Required' : 'All Reviewed'}
            </span>
            <span className="text-slate-400">VRP Solved</span>
          </div>
        </div>

        {/* Metric 3: Total Unserved Backlog */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between border-l-4 border-l-red-600">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs uppercase font-mono tracking-wider font-semibold">
              Unserved Demand Across Plans
            </span>
            <span className="material-symbols-outlined text-red-600 text-xl">report_problem</span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-red-700">
              {totalUnservedCount}{' '}
              <span className="text-sm text-slate-500 font-normal">Unserved Requests</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Excluded due to craft capacity, shift limit, or safety constraints
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
            <span className="text-red-700 font-semibold">
              {totalUnservedCount > 0 ? 'Requires Resource Scaling' : 'Demand Covered'}
            </span>
            <span className="text-slate-400">Capacity Constrained</span>
          </div>
        </div>

        {/* Metric 4: Total Requests Allocated */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between border-l-4 border-l-slate-600">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs uppercase font-mono tracking-wider font-semibold">
              Requests Allocated
            </span>
            <span className="material-symbols-outlined text-slate-600 text-xl">group</span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-slate-900">
              {totalServedRequests}{' '}
              <span className="text-sm text-slate-500 font-normal">Served Targets</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Planned pickups matched to available relief fleet
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-700 font-semibold">Active Invariant</span>
            <span className="text-slate-400">Strict Capacity Safe</span>
          </div>
        </div>
      </section>

      {/* Main Table Workspace */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Table Filters Strip */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-1 border border-slate-300 p-0.5 rounded-lg bg-white">
            <button
              type="button"
              onClick={() => setFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filterTab === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Plans ({plans.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('PROPOSED')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                filterTab === 'PROPOSED'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Proposed</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-900 font-bold">
                {proposedCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('COMMITTED')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                filterTab === 'COMMITTED'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Committed</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-teal-100 text-teal-900 font-bold">
                {committedCount}
              </span>
            </button>
          </div>

          <div className="w-full sm:w-72">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-slate-400 text-lg">
                search
              </span>
              <input
                type="text"
                placeholder="Search plan ID, scenario, notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8.5 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={fetchAssignments}
              className="font-bold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold">Plan Identifier</th>
                <th className="py-3 px-4 font-semibold">Scenario</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Assigned Fleet</th>
                <th className="py-3 px-4 font-semibold">Served Requests</th>
                <th className="py-3 px-4 font-semibold">Unserved</th>
                <th className="py-3 px-4 font-semibold">Travel Time / Distance</th>
                <th className="py-3 px-4 font-semibold">Created / Updated</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {isLoading && plans.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <span className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      <span>Loading assignment plans from database...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <span className="material-symbols-outlined text-4xl text-slate-300 block mb-1">
                      inbox
                    </span>
                    <p className="font-semibold text-slate-700">No assignment plans found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery || filterTab !== 'ALL'
                        ? 'Try clearing the search or filter tab.'
                        : 'Generate a new solver proposal to begin fleet assignment.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPlans.map((plan) => {
                  const routesCount = plan.routes?.length ?? 0;
                  const servedCount = plan.metrics?.servedRequestsCount ?? 0;
                  const unservedCount = plan.unserved?.length ?? 0;
                  const travelTimeMin = plan.metrics?.totalTravelTimeMinutes
                    ? `${plan.metrics.totalTravelTimeMinutes.toFixed(1)}m`
                    : '—';
                  const travelDistKm = plan.metrics?.totalTravelDistanceKm
                    ? `${plan.metrics.totalTravelDistanceKm.toFixed(1)}km`
                    : '—';
                  const scenario = plan.scenario_id ?? plan.scenarioId ?? '—';

                  return (
                    <tr
                      key={plan.id}
                      className="hover:bg-slate-50/80 transition-colors group font-sans"
                    >
                      <td className="py-3 px-4">
                        <Link
                          href={`/operator/assignments/${plan.id}`}
                          className="font-mono font-bold text-teal-800 hover:text-teal-950 flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm text-teal-600">
                            assignment
                          </span>
                          <span>{plan.id}</span>
                        </Link>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{scenario}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={plan.status} />
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {routesCount} {routesCount === 1 ? 'Craft' : 'Crafts'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-emerald-700">{servedCount}</span>
                        <span className="text-slate-400 text-[11px] ml-1">Served</span>
                      </td>
                      <td className="py-3 px-4">
                        {unservedCount > 0 ? (
                          <span className="font-bold text-red-600 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                            {unservedCount} Unserved
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <span className="text-slate-900 font-semibold">{travelTimeMin}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-slate-600">{travelDistKm}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {plan.createdAt ? formatRegionDateTime(plan.createdAt) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={`/operator/assignments/${plan.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors"
                        >
                          <span>Review</span>
                          <span className="material-symbols-outlined text-xs">arrow_forward</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Solver Proposal Generation Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-teal-700 text-2xl">psychology</span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Generate VRP Solver Proposal</h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Deterministic Fleet Optimization Engine
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {newlyCreatedPlanId ? (
              <div className="space-y-4 py-2">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-950 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                    <span className="material-symbols-outlined text-emerald-700">task_alt</span>
                    <span>Solver Proposal Successfully Generated!</span>
                  </div>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    New assignment plan{' '}
                    <strong className="font-mono bg-emerald-100 px-1 py-0.5 rounded">
                      {newlyCreatedPlanId}
                    </strong>{' '}
                    has been calculated and stored with status <strong>PROPOSED</strong>.
                  </p>
                </div>

                {/* Selected Request Inclusion Feedback */}
                {requestId && requestInclusionResult && (
                  <div className="space-y-2">
                    {requestInclusionResult.status === 'SERVED' ? (
                      <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 p-3.5 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                          <span className="material-symbols-outlined text-base text-emerald-700">
                            check_circle
                          </span>
                          <span>Focused Request #{requestId} Included in Proposed Routes</span>
                        </div>
                        <p className="text-emerald-900 leading-relaxed">
                          {requestInclusionResult.message}
                        </p>
                      </div>
                    ) : requestInclusionResult.status === 'UNSERVED' ? (
                      <div className="bg-amber-50 border border-amber-300 text-amber-950 p-3.5 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800">
                          <span className="material-symbols-outlined text-base text-amber-700">
                            warning
                          </span>
                          <span>Focused Request #{requestId} Remained Unserved</span>
                        </div>
                        <p className="text-amber-900 leading-relaxed">
                          {requestInclusionResult.message}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200 text-slate-800 p-3.5 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-slate-700">
                          <span className="material-symbols-outlined text-base text-slate-600">
                            info
                          </span>
                          <span>Focused Request #{requestId} Evaluation</span>
                        </div>
                        <p className="text-slate-600 leading-relaxed">
                          {requestInclusionResult.message}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowGenerateModal(false);
                      setNewlyCreatedPlanId(null);
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Done
                  </button>
                  <Link
                    href={`/operator/assignments/${newlyCreatedPlanId}`}
                    className="px-4 py-2 bg-[#0066CC] hover:bg-[#0055b3] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Open Review &amp; Commit Screen</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleGenerateProposal} className="space-y-4">
                {/* Focused Request Ineligibility Warning inside modal */}
                {!isPlanningAllowed && (
                  <div className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-lg text-xs text-amber-900 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800">
                      <span className="material-symbols-outlined text-base text-amber-700">
                        warning
                      </span>
                      <span>Proposal Generation Blocked: Ineligible Focused Incident</span>
                    </div>
                    <p className="leading-relaxed">{planningDisabledReason}</p>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-[11px] text-amber-800">
                        To run scenario optimization across all other pending requests:
                      </span>
                      <Link
                        href="/operator/assignments"
                        onClick={() => setShowGenerateModal(false)}
                        className="px-2.5 py-1 bg-amber-200/80 hover:bg-amber-300 text-amber-950 font-bold rounded text-xs inline-flex items-center gap-1 transition-colors"
                      >
                        <span>Clear Context</span>
                        <span className="material-symbols-outlined text-xs">close</span>
                      </Link>
                    </div>
                  </div>
                )}

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
                  <div className="font-bold text-slate-800 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[#0066CC] text-sm">info</span>
                    <span>Decision-Support Optimization Engine</span>
                  </div>
                  <p className="leading-relaxed">
                    Generates an optimal route proposal across pending requests and available craft.
                    The resulting plan remains in <strong>PROPOSED</strong> status until an operator
                    reviews and explicitly commits it.
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono pt-1">
                    * Google OR-Tools is an offline benchmark solver. Live proposals execute the
                    production deterministic VRP engine.
                  </p>
                </div>

                {proposalError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <span className="material-symbols-outlined text-base shrink-0 mt-0.5">
                      error
                    </span>
                    <div>
                      <span className="font-bold">Proposal Failed: </span>
                      {proposalError}
                    </div>
                  </div>
                )}

                {/* Algorithm Selection */}
                <div className="space-y-1">
                  <label
                    htmlFor="solver-algo"
                    className="block text-xs font-bold text-slate-800 font-mono"
                  >
                    VRP Solver Algorithm
                  </label>
                  <select
                    id="solver-algo"
                    value={algorithm}
                    onChange={(e) =>
                      setAlgorithm(
                        e.target.value as 'cluster-allocation' | 'nearest-first' | 'savings',
                      )
                    }
                    className="w-full h-9 rounded border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:ring-1 focus:ring-[#0066CC] focus:border-[#0066CC]"
                  >
                    <option value="cluster-allocation">
                      Cluster Allocation (DBSCAN + VRP) — Recommended
                    </option>
                    <option value="savings">
                      Clarke-Wright Savings Baseline (Fast tour merges)
                    </option>
                    <option value="nearest-first">
                      Nearest First (Greedy, minimizes initial wait)
                    </option>
                  </select>
                </div>

                {/* Scenario ID */}
                <div className="space-y-1">
                  <label
                    htmlFor="scenario-id"
                    className="block text-xs font-bold text-slate-800 font-mono"
                  >
                    Scenario Identifier
                  </label>
                  <input
                    id="scenario-id"
                    type="text"
                    value={scenarioId}
                    onChange={(e) => setScenarioId(e.target.value)}
                    placeholder="scenario-delhi-yamuna-demo"
                    className="w-full h-9 rounded border border-slate-300 bg-white px-3 text-xs font-mono text-slate-800 focus:ring-1 focus:ring-[#0066CC] focus:border-[#0066CC]"
                  />
                </div>

                {/* Max Shift Minutes */}
                <div className="space-y-1">
                  <label
                    htmlFor="max-shift"
                    className="block text-xs font-bold text-slate-800 font-mono"
                  >
                    Maximum Shift Duration (Minutes)
                  </label>
                  <input
                    id="max-shift"
                    type="number"
                    min="30"
                    max="1440"
                    value={maxShiftMinutes}
                    onChange={(e) => setMaxShiftMinutes(Number(e.target.value))}
                    className="w-full h-9 rounded border border-slate-300 bg-white px-3 text-xs font-mono text-slate-800 focus:ring-1 focus:ring-[#0066CC] focus:border-[#0066CC]"
                  />
                </div>

                {/* Checkboxes */}
                <div className="space-y-2 pt-1 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preserveFrozen}
                      onChange={(e) => setPreserveFrozen(e.target.checked)}
                      className="rounded text-[#0066CC] focus:ring-[#0066CC] border-slate-300 cursor-pointer"
                    />
                    <span className="text-slate-700">
                      Preserve existing frozen stops from previous committed plan
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeUnverified}
                      onChange={(e) => setIncludeUnverified(e.target.checked)}
                      className="rounded text-[#0066CC] focus:ring-[#0066CC] border-slate-300 cursor-pointer"
                    />
                    <span className="text-slate-700">
                      Include unverified requests in proposal optimization
                    </span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    disabled={isSubmittingProposal}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingProposal || !isPlanningAllowed}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ${
                      !isPlanningAllowed
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-75'
                        : isSubmittingProposal
                          ? 'bg-blue-400 text-white cursor-not-allowed'
                          : 'bg-[#0066CC] hover:bg-[#0055b3] text-white'
                    }`}
                    title={
                      !isPlanningAllowed
                        ? planningDisabledReason ||
                          'Planning disabled while focused request is ineligible'
                        : 'Generate solver proposal'
                    }
                  >
                    {isSubmittingProposal ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Running Solver...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">psychology</span>
                        <span>Generate Solver Proposal</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OperatorAssignmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs font-mono text-slate-500">
          Loading assignments workspace...
        </div>
      }
    >
      <OperatorAssignmentsContent />
    </Suspense>
  );
}
