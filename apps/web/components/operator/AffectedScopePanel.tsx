'use client';

import React from 'react';
import type { AffectedScopeResult } from '@/lib/api/types';

export interface AffectedScopePanelProps {
  scope: AffectedScopeResult;
  onTriggerRepair?: () => void;
  isRepairing?: boolean;
  canRequestRepair?: boolean;
}

export function AffectedScopePanel({
  scope,
  onTriggerRepair,
  isRepairing = false,
  canRequestRepair = true,
}: AffectedScopePanelProps) {
  return (
    <div className="space-y-3 text-xs" data-testid="affected-scope-panel">
      <p className="text-on-surface-variant italic">Reason: {scope.reason}</p>

      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="p-2.5 bg-surface rounded-lg border border-outline-variant/30">
          <span className="text-on-surface-variant block">Affected Requests</span>
          <span className="text-sm font-bold text-on-surface">
            {scope.affectedRequestIds.length}
          </span>
          {scope.affectedRequestIds.length > 0 && (
            <span className="text-[10px] text-on-surface-variant block truncate">
              {scope.affectedRequestIds.join(', ')}
            </span>
          )}
        </div>

        <div className="p-2.5 bg-surface rounded-lg border border-outline-variant/30">
          <span className="text-on-surface-variant block">Affected Resources</span>
          <span className="text-sm font-bold text-on-surface">
            {scope.affectedResourceIds.length}
          </span>
          {scope.affectedResourceIds.length > 0 && (
            <span className="text-[10px] text-on-surface-variant block truncate">
              {scope.affectedResourceIds.join(', ')}
            </span>
          )}
        </div>

        <div className="p-2.5 bg-surface rounded-lg border border-outline-variant/30">
          <span className="text-on-surface-variant block">Proposed Plans Needing Attention</span>
          <span className="text-sm font-bold text-primary">
            {scope.affectedProposedAssignmentIds.length}
          </span>
          {scope.affectedProposedAssignmentIds.length > 0 && (
            <span className="text-[10px] text-on-surface-variant block truncate">
              {scope.affectedProposedAssignmentIds.join(', ')}
            </span>
          )}
        </div>

        <div className="p-2.5 bg-surface rounded-lg border border-outline-variant/30">
          <span className="text-on-surface-variant block">Committed Missions Requiring Review</span>
          <span className="text-sm font-bold text-amber-600">
            {scope.committedAssignmentsRequiringReview.length}
          </span>
          {scope.committedAssignmentsRequiringReview.length > 0 && (
            <span className="text-[10px] text-on-surface-variant block truncate">
              {scope.committedAssignmentsRequiringReview.join(', ')}
            </span>
          )}
        </div>
      </div>

      {scope.committedAssignmentsRequiringReview.length > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <span className="material-symbols-outlined text-base shrink-0 mt-0.5">warning</span>
          <div>
            <span className="font-bold block">Committed Rescue Missions Impacted</span>
            <span>
              Active committed missions ({scope.committedAssignmentsRequiringReview.join(', ')}) are
              affected by this incident. Human dispatcher intervention is required.
            </span>
          </div>
        </div>
      )}

      {/* Action / Repair Button */}
      <div className="pt-2 flex items-center justify-end">
        {canRequestRepair ? (
          <button
            className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            disabled={isRepairing || !scope.repairEligible}
            onClick={onTriggerRepair}
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
            Role cannot trigger repairs
          </span>
        )}
      </div>
    </div>
  );
}
