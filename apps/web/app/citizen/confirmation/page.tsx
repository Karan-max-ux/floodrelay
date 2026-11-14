'use client';

import { REGION_CONFIG, formatRegionDateTime } from '@/lib/region';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { UrgencyLevel } from '@floodrelay/shared';

interface CitizenReceipt {
  id: string;
  createdAt: string;
  urgency: UrgencyLevel;
  peopleCount: number;
  isFlaggedDuplicate: boolean;
  duplicateOfId: string | null;
  idempotent: boolean;
  addressSummary?: string;
  approxLat?: number;
  approxLng?: number;
  waterLevel?: string;
  hasSpecialNeeds?: boolean;
  hasFieldNotes?: boolean;
  // Backward compatibility with legacy receipts
  address?: string;
  lat?: number;
  lng?: number;
  specialNeeds?: string[];
  notes?: string;
}

export default function CitizenConfirmationPage() {
  const [receipt, setReceipt] = useState<CitizenReceipt | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem('floodrelay_citizen_receipt');
        if (stored) {
          setReceipt(JSON.parse(stored));
        }
      }
    } catch (e) {
      console.warn('Failed to parse citizen receipt from sessionStorage:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const copyTicketId = () => {
    if (receipt?.id && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(receipt.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTimestamp = (isoString?: string): string =>
    isoString ? formatRegionDateTime(isoString) : 'Just now';

  if (isLoading) {
    return (
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-16 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-on-surface-variant">
          <span className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold">Loading your request receipt...</span>
        </div>
      </main>
    );
  }

  // Fallback state when accessed directly without an active session receipt
  if (!receipt) {
    return (
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-8 py-12 pb-20">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl">info</span>
          </div>

          <div className="space-y-2">
            <h1 className="font-manrope text-2xl md:text-3xl font-bold text-on-surface">
              No Active Rescue Request Found in Session
            </h1>
            <p className="text-sm text-on-surface-variant max-w-lg mx-auto leading-relaxed">
              No recent emergency submission was detected in this browser session. If you or someone
              near you requires flood evacuation or medical rescue, please submit a request or call
              112 for emergency assistance.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Link
              className="w-full sm:w-auto px-6 py-3 rounded-lg bg-primary-container text-on-primary font-bold text-sm hover:bg-primary transition-colors flex items-center justify-center gap-2"
              href="/citizen/request"
            >
              <span className="material-symbols-outlined text-lg">emergency</span>
              <span>Submit Rescue Assistance Request</span>
            </Link>
            <Link
              className="w-full sm:w-auto px-6 py-3 rounded-lg bg-surface-container border border-outline-variant text-on-surface font-semibold text-sm hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
              href="/citizen"
            >
              <span className="material-symbols-outlined text-lg">home</span>
              <span>Return to Public Portal</span>
            </Link>
          </div>

          <div className="pt-6 border-t border-outline-variant text-xs text-on-surface-variant">
            <span>In immediate life-threatening situations, dial </span>
            <a className="font-bold text-tertiary underline" href="tel:112">
              112
            </a>
            <span> or contact your local emergency management agency.</span>
          </div>
        </div>
      </main>
    );
  }

  const urgencyBadgeConfig: Record<
    UrgencyLevel,
    { label: string; badgeClass: string; dotClass: string }
  > = {
    CRITICAL: {
      label: 'Critical Urgency (Immediate Danger)',
      badgeClass: 'bg-red-100 text-red-900 border-red-300',
      dotClass: 'bg-red-600',
    },
    HIGH: {
      label: 'High Urgency (Rising Water)',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      dotClass: 'bg-amber-600',
    },
    MEDIUM: {
      label: 'Moderate Risk',
      badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
      dotClass: 'bg-blue-600',
    },
    LOW: {
      label: 'Low Priority (Precautionary)',
      badgeClass: 'bg-slate-200 text-slate-800 border-slate-300',
      dotClass: 'bg-slate-500',
    },
  };

  const currentBadge = urgencyBadgeConfig[receipt.urgency] || urgencyBadgeConfig.HIGH;

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-12 pb-20">
      {/* System Status Micro-Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 mb-6 bg-surface-container-low border border-outline-variant rounded-lg text-xs text-on-surface-variant">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600" />
          <span>{REGION_CONFIG.label} • FloodRelay Request Portal</span>
        </div>
        <span className="font-mono text-[11px] font-bold text-emerald-800 uppercase bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
          Request Receipt
        </span>
      </div>

      {/* Confirmation Header Banner */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 md:p-8 mb-8 text-center relative overflow-hidden">
        <div className="max-w-2xl mx-auto flex flex-col items-center">
          {/* Reassuring Emerald Checkmark Ring */}
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary-fixed/40 border-2 border-primary-container flex items-center justify-center mb-5 text-primary">
            <span
              className="material-symbols-outlined text-4xl md:text-5xl"
              data-icon="check_circle"
            >
              check_circle
            </span>
          </div>

          <h1 className="font-manrope text-2xl md:text-4xl text-on-surface font-extrabold tracking-tight mb-3">
            Your Request Has Been Submitted
          </h1>

          {/* Transparent Operational Status Disclosure */}
          <div className="bg-surface-container-low border-l-4 border-primary-container px-4 py-3 rounded text-left w-full mt-2">
            <p className="text-sm font-semibold text-on-surface">
              <span className="text-primary font-bold">Important Status Disclosure:</span> Your
              request has been recorded in FloodRelay for operator review. This does not mean a
              rescue team has been dispatched.
            </p>
            <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
              FloodRelay records decisions but does not deploy physical crews. For immediate danger,
              call 112.
            </p>
          </div>
        </div>
      </section>

      {/* Potential Duplicate Advisory (Non-Alarmist) */}
      {receipt.isFlaggedDuplicate && (
        <aside className="mb-8 p-5 rounded-xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex items-start gap-4">
          <span className="material-symbols-outlined text-amber-700 text-2xl mt-0.5">info</span>
          <div className="space-y-1">
            <strong className="block text-amber-900 font-bold text-sm tracking-wide">
              Potential Duplicate Flagged for Coordinator Review
            </strong>
            <p className="text-xs text-amber-900 leading-relaxed">
              A rescue request was recently submitted at or near this location. Your report has been
              securely linked to that coordinate cluster for operator inspection. Our dispatch
              coordinators consolidate nearby reports to prevent redundant resource deployment while
              ensuring all occupants are accounted for.
            </p>
          </div>
        </aside>
      )}

      {/* Idempotent Confirmation Notice */}
      {receipt.idempotent && (
        <aside className="mb-8 p-4 rounded-xl bg-blue-50 border border-blue-300 text-blue-950 flex items-start gap-3">
          <span className="material-symbols-outlined text-blue-600 text-xl mt-0.5">verified</span>
          <div>
            <strong className="block text-blue-900 font-bold text-xs uppercase tracking-wide">
              Existing Record Confirmed
            </strong>
            <p className="text-xs text-blue-900">
              This request was previously received and confirmed in the dispatch queue. No duplicate
              dispatch record was created.
            </p>
          </div>
        </aside>
      )}

      {/* Grid: Ticket Details + Operational Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        {/* Left Column: Request Summary Card */}
        <section className="lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-outline-variant pb-4 mb-5">
              <div>
                <span className="font-mono text-xs uppercase font-bold text-on-surface-variant block">
                  OFFICIAL RECEIPT
                </span>
                <h2 className="font-manrope text-xl text-on-surface font-bold">Request Summary</h2>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${currentBadge.badgeClass}`}
              >
                <span className={`w-2 h-2 rounded-full inline-block ${currentBadge.dotClass}`} />
                <span>{currentBadge.label}</span>
              </span>
            </div>

            {/* Reference Ticket ID Highlight */}
            <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs text-on-surface-variant block font-medium">
                  Reference Ticket ID
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-lg md:text-xl font-bold text-primary tracking-tight select-all break-all"
                    id="ticket-id"
                  >
                    {receipt.id}
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-300">
                    Live Record
                  </span>
                </div>
              </div>
              <button
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-xs font-semibold text-on-surface hover:bg-surface-container active:scale-95 transition-all shrink-0"
                onClick={copyTicketId}
                type="button"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                <span>{copied ? 'Copied to Clipboard' : 'Copy Reference ID'}</span>
              </button>
            </div>

            {/* Metadata Spec List */}
            <div className="space-y-4 text-xs md:text-sm">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl mt-0.5">
                  schedule
                </span>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">Logged Timestamp</p>
                  <p className="text-on-surface font-semibold">
                    {formatTimestamp(receipt.createdAt)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl mt-0.5">
                  pin_drop
                </span>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">
                    Reported Incident Location
                  </p>
                  <p className="text-on-surface font-semibold">
                    {receipt.addressSummary || receipt.address || 'Reported Location'}
                  </p>
                  <span className="text-xs font-mono text-on-surface-variant">
                    Sector: {(receipt.approxLat ?? receipt.lat ?? 0).toFixed(2)}° N,{' '}
                    {(receipt.approxLng ?? receipt.lng ?? 0).toFixed(2)}° W
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl mt-0.5">
                  water_damage
                </span>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">
                    Reported Water Level
                  </p>
                  <p className="text-on-surface font-semibold">{receipt.waterLevel}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl mt-0.5">group</span>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">
                    Occupancy &amp; Dispatch Status
                  </p>
                  <p className="text-on-surface font-semibold">
                    {receipt.peopleCount} {receipt.peopleCount === 1 ? 'Person' : 'Persons'} logged
                    for evacuation
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {(receipt.hasSpecialNeeds ??
                      (receipt.specialNeeds && receipt.specialNeeds.length > 0)) && (
                      <span className="px-2 py-0.5 bg-surface-container rounded font-mono text-[11px] font-semibold text-on-surface-variant">
                        Special evacuation assistance logged
                      </span>
                    )}
                    {(receipt.hasFieldNotes ?? Boolean(receipt.notes)) && (
                      <span className="px-2 py-0.5 bg-surface-container rounded font-mono text-[11px] font-semibold text-on-surface-variant">
                        Crew navigation instructions recorded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-outline-variant flex items-center justify-between text-xs text-on-surface-variant">
            <span>Intake Channel: FloodRelay Web Portal</span>
            <span className="inline-flex items-center gap-1 text-primary font-bold">
              <span className="material-symbols-outlined text-sm">verified_user</span>
              Request Recorded
            </span>
          </div>
        </section>

        {/* Right Column: What Happens Next */}
        <section className="lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="border-b border-outline-variant pb-4 mb-5">
              <span className="font-mono text-xs uppercase font-bold text-primary block">
                PROGRESSION ROADMAP
              </span>
              <h2 className="font-manrope text-xl text-on-surface font-bold">What Happens Next</h2>
            </div>

            <ol className="relative border-l border-outline-variant ml-3 space-y-6">
              {/* Step 1 */}
              <li className="pl-6 relative">
                <span className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-xs font-bold font-mono">
                  1
                </span>
                <h3 className="text-sm font-bold text-on-surface">Triage Review</h3>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                  An authorised operator may review the request details and assess its priority.
                  This is not a promise of emergency dispatch.
                </p>
              </li>

              {/* Step 2 */}
              <li className="pl-6 relative">
                <span className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant flex items-center justify-center text-xs font-bold font-mono">
                  2
                </span>
                <h3 className="text-sm font-bold text-on-surface">Route Inclusion</h3>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                  If an operator approves an assignment, your request may be included in a proposed
                  rescue route.
                </p>
              </li>

              {/* Step 3 */}
              <li className="pl-6 relative">
                <span className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant flex items-center justify-center text-xs font-bold font-mono">
                  3
                </span>
                <h3 className="text-sm font-bold text-on-surface">Extraction &amp; Transport</h3>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                  A committed plan records a decision in FloodRelay. Physical rescue requires
                  coordination with actual emergency responders.
                </p>
              </li>
            </ol>
          </div>

          <div className="mt-8 pt-4 border-t border-outline-variant space-y-3">
            <Link
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-container text-on-surface text-xs font-bold hover:bg-surface-container-high transition-colors"
              href="/citizen"
            >
              <span>Return to Public Portal</span>
              <span className="material-symbols-outlined text-sm">home</span>
            </Link>

            <p className="text-[11px] text-center text-on-surface-variant">
              Keep your reference ID handy for contact with local emergency responders.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
