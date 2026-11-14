'use client';

import React, { useState, useMemo } from 'react';
import type { SolverPlan } from '@floodrelay/shared';
import type { RepairResult } from '@/lib/api/types';
import {
  computeRepairDiff,
  SIMULATED_BASELINE_PLAN,
  SIMULATED_REPAIR_RESULT,
} from '@/lib/fixtures/repairFixtures';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';
import RepairMetrics from './RepairMetrics';
import ChurnSummary from './ChurnSummary';
import ChangedStopList from './ChangedStopList';
import RepairWarnings from './RepairWarnings';

interface RepairComparisonProps {
  baselinePlan?: SolverPlan | null;
  repairResult?: RepairResult | null;
  isSimulated?: boolean;
  isSolverUnavailable?: boolean;
  onCommitLivePlan?: (plan: SolverPlan, notes?: string) => Promise<void>;
  onClose?: () => void;
}

export default function RepairComparison({
  baselinePlan,
  repairResult,
  isSimulated: initialIsSimulated = false,
  isSolverUnavailable = false,
  onCommitLivePlan,
  onClose,
}: RepairComparisonProps) {
  const { operator } = useOperatorAuth();
  const canCommit = hasPermission(operator, 'COMMIT_ASSIGNMENT');

  const [useFixture, setUseFixture] = useState<boolean>(initialIsSimulated);
  const [operatorNotes, setOperatorNotes] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<boolean>(false);
  const [showCommitModal, setShowCommitModal] = useState<boolean>(false);

  // Active plans to compare (either real or fixture)
  const activeBaseline: SolverPlan | null = useMemo(() => {
    if (useFixture) return SIMULATED_BASELINE_PLAN;
    return baselinePlan || null;
  }, [useFixture, baselinePlan]);

  const activeRepairResult: RepairResult | null = useMemo(() => {
    if (useFixture) return SIMULATED_REPAIR_RESULT;
    return repairResult || null;
  }, [useFixture, repairResult]);

  const activeRepairedPlan: SolverPlan | null = activeRepairResult?.proposedPlan || null;

  // Compute diff analysis
  const diffAnalysis = useMemo(() => {
    if (!activeBaseline || !activeRepairedPlan) return null;
    return computeRepairDiff(activeBaseline, activeRepairedPlan);
  }, [activeBaseline, activeRepairedPlan]);

  const handleCommit = async () => {
    if (!activeRepairedPlan || !onCommitLivePlan || useFixture || !canCommit) return;

    try {
      setIsCommitting(true);
      setCommitError(null);
      await onCommitLivePlan(activeRepairedPlan, operatorNotes);
      setCommitSuccess(true);
      setShowCommitModal(false);
    } catch (err) {
      const errMsg = (err as Error).message || 'Failed to commit repaired plan';
      if (
        errMsg.includes('409') ||
        errMsg.includes('CONFLICT') ||
        errMsg.includes('ALREADY_COMMITTED')
      ) {
        setCommitError(
          'Version Conflict (409): The baseline plan has been updated by another operator. Please refresh before committing.',
        );
      } else {
        setCommitError(errMsg);
      }
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="bg-surface-container rounded-2xl border border-outline-variant/30 overflow-hidden shadow-2xl flex flex-col">
      {/* 1. Header with Status & Dismiss */}
      <div className="p-4 bg-surface-container-high border-b border-outline-variant/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-tertiary/20 text-tertiary flex items-center justify-center">
            <span className="material-symbols-outlined text-lg">alt_route</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              Assignment Plan Repair Evaluation
              {useFixture && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/50">
                  SIMULATED FIXTURE
                </span>
              )}
            </h2>
            <p className="text-xs text-on-surface-variant">
              Human-in-the-loop comparison of baseline routes against proposed incremental repair
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {isSolverUnavailable && !useFixture && (
            <button
              onClick={() => setUseFixture(true)}
              className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined text-sm">science</span>
              <span>Load Test Fixture</span>
            </button>
          )}

          {useFixture && (
            <button
              onClick={() => setUseFixture(false)}
              className="px-3 py-1.5 rounded-lg bg-surface-container-highest hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-colors"
              type="button"
            >
              Return to Live State
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              title="Close comparison drawer"
              type="button"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Banner for 503 Solver Engine Unavailable */}
      {isSolverUnavailable && !useFixture && (
        <div className="bg-amber-950/40 border-b border-amber-600/50 p-4 text-xs text-amber-200 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-400 text-lg shrink-0 mt-0.5">
            engineering
          </span>
          <div className="space-y-1">
            <div className="font-bold text-amber-300">
              Phase 5 Part 2 Incremental Solver Engine Unavailable (HTTP 503)
            </div>
            <p className="text-amber-200/90 leading-relaxed">
              The live replanning solver algorithms are currently being developed by the
              optimization team. To preview the complete Phase 5 Part 3 comparison and churn user
              interface, click{' '}
              <button
                onClick={() => setUseFixture(true)}
                className="underline font-bold text-amber-100 hover:text-white"
                type="button"
              >
                Load Test Fixture
              </button>
              . Real operational requests and assignments will remain unaltered.
            </p>
          </div>
        </div>
      )}

      {/* 3. Banner for Simulated Fixture Mode */}
      {useFixture && (
        <div className="bg-sky-950/40 border-b border-sky-600/50 p-3 text-xs text-sky-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sky-400 text-base">info</span>
            <span>
              <strong>Deterministic Test Fixture Active:</strong> Synthetic Delhi–Yamuna test
              scenario for UI validation. Real database commitment is strictly locked.
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold bg-sky-900/60 px-2 py-0.5 rounded border border-sky-500/40 text-sky-300 shrink-0">
            READ-ONLY PREVIEW
          </span>
        </div>
      )}

      {/* Commit Success Alert */}
      {commitSuccess && (
        <div className="bg-emerald-950/40 border-b border-emerald-600/50 p-3 text-xs text-emerald-200 flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>
          <span>
            Repaired plan successfully committed to operational database! New routes are now active.
          </span>
        </div>
      )}

      {/* Commit Error Alert */}
      {commitError && (
        <div className="bg-red-950/40 border-b border-red-600/50 p-3 text-xs text-red-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-400 text-base">error</span>
            <span>{commitError}</span>
          </div>
          <button
            onClick={() => setCommitError(null)}
            className="text-red-300 hover:text-white"
            type="button"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* 4. Comparison Body */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-14rem)]">
        {!activeRepairedPlan ? (
          <div className="p-12 text-center text-xs text-on-surface-variant space-y-2">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant">
              pending_actions
            </span>
            <p>No repair proposal available to compare.</p>
            {isSolverUnavailable && (
              <button
                onClick={() => setUseFixture(true)}
                className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold"
                type="button"
              >
                Inspect Simulated Fixture
              </button>
            )}
          </div>
        ) : !activeBaseline ? (
          <div className="p-12 text-center text-xs text-on-surface-variant space-y-2">
            <span className="material-symbols-outlined text-3xl text-amber-400">warning</span>
            <p className="font-semibold text-on-surface">
              Baseline Plan Not Available — Cannot compute comparative churn.
            </p>
            <p className="text-on-surface-variant max-w-sm mx-auto">
              A baseline operational plan is required to calculate stop differences, passenger
              movement, and schedule churn.
            </p>
          </div>
        ) : !diffAnalysis ? (
          <div className="p-12 text-center text-xs text-on-surface-variant space-y-2">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant">
              sync_problem
            </span>
            <p>Plan differential analysis could not be computed.</p>
          </div>
        ) : (
          <>
            {/* Metrics Grid */}
            <RepairMetrics
              baselineMetrics={activeBaseline.metrics}
              repairedMetrics={activeRepairedPlan.metrics}
              coverageDeltaPercent={diffAnalysis.coverageDeltaPercent}
              travelTimeDeltaMinutes={diffAnalysis.travelTimeDeltaMinutes}
              highPriorityWaitDeltaMinutes={diffAnalysis.highPriorityWaitDeltaMinutes}
              unservedDelta={diffAnalysis.unservedDelta}
            />

            {/* Churn Summary */}
            <ChurnSummary
              churnPercent={diffAnalysis.churnPercent}
              movedRequestsCount={diffAnalysis.movedRequestsCount}
              addedStopsCount={diffAnalysis.addedStopsCount}
              removedStopsCount={diffAnalysis.removedStopsCount}
              reassignedStopsCount={diffAnalysis.reassignedStopsCount}
              reorderedStopsCount={diffAnalysis.reorderedStopsCount}
              frozenStopsCount={diffAnalysis.frozenStopsCount}
              unchangedStopsCount={diffAnalysis.unchangedStopsCount}
            />

            {/* Warnings and Unserved Demands */}
            <RepairWarnings
              warnings={activeRepairResult?.warnings}
              unservedRequests={activeRepairedPlan.unserved}
            />

            {/* Stop-by-Stop Diff Breakdown */}
            <ChangedStopList stopDiffs={diffAnalysis.stopDiffs} />

            {/* Decision Support Disclaimer */}
            <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/40 text-[11px] text-on-surface-variant flex items-start gap-2">
              <span className="material-symbols-outlined text-sm text-primary shrink-0 mt-0.5">
                gavel
              </span>
              <p>
                <strong>Decision Support Only:</strong> Authorizing plan commitment records
                decisions in the database. It does not initiate automated physical vehicle dispatch.
              </p>
            </div>

            {/* Human Supervisor Action Bar */}
            <div className="pt-2 border-t border-outline-variant/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-xs text-on-surface-variant">
                {useFixture ? (
                  <span className="text-amber-400 font-medium">
                    Commitment disabled for test fixture. Live solver integration required for
                    operational dispatch.
                  </span>
                ) : !canCommit ? (
                  <span className="text-on-surface-variant">
                    Your role ({operator?.role || 'OPERATOR'}) has read-only privileges. Dispatcher
                    or Admin authorization required to commit plans.
                  </span>
                ) : (
                  <span className="text-emerald-400 font-medium">
                    Human supervisor verification: Review frozen stops and unserved demand before
                    committing.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                {onClose && (
                  <button
                    onClick={onClose}
                    className="px-3.5 py-2 rounded-lg bg-surface-container-highest hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors"
                    type="button"
                  >
                    Cancel
                  </button>
                )}

                <button
                  onClick={() => setShowCommitModal(true)}
                  disabled={useFixture || !canCommit || isCommitting}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                  type="button"
                  title={
                    useFixture
                      ? 'Commitment disabled for test fixtures'
                      : !canCommit
                        ? 'Dispatcher or Admin authorization required'
                        : 'Commit repaired assignment plan'
                  }
                >
                  <span className="material-symbols-outlined text-sm">how_to_reg</span>
                  <span>Commit Repaired Plan</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Commit Confirmation Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface-container-high border border-outline-variant/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">check_circle</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-on-surface">Confirm Plan Commitment</h3>
                <p className="text-xs text-on-surface-variant">
                  Authorizing operational redeployment
                </p>
              </div>
            </div>

            <p className="text-xs text-on-surface leading-relaxed">
              Committing this plan will freeze scheduled stops, update field vehicle routes, and
              mark associated rescue requests as ASSIGNED.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface">
                Operator Notes (Optional)
              </label>
              <textarea
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                placeholder="e.g. Approved detour around Heights Blvd surge hazard."
                className="w-full h-20 p-2.5 rounded-lg bg-surface-container border border-outline-variant text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCommitModal(false)}
                disabled={isCommitting}
                className="px-3.5 py-2 rounded-lg bg-surface-container-highest text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={isCommitting}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                type="button"
              >
                {isCommitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Committing...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">lock</span>
                    <span>Confirm & Commit</span>
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
