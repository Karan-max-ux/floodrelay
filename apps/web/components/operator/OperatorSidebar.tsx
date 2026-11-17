'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';

export function OperatorSidebar() {
  const pathname = usePathname();
  const { operator, logout } = useOperatorAuth();

  const isOverview = pathname === '/operator';
  const isRequests = pathname.startsWith('/operator/requests');
  const isMap = pathname.startsWith('/operator/map');
  const isAssignments = pathname.startsWith('/operator/assignments');
  const isEvents = pathname.startsWith('/operator/events');
  const isAudit = pathname.startsWith('/operator/audit');

  return (
    <aside className="hidden lg:block fixed top-0 left-0 h-screen w-64 z-40 bg-inverse-surface border-r border-outline-variant/20 shadow-none font-inter select-none">
      <div className="flex flex-col justify-between h-full p-4 w-64">
        {/* Top Brand & Navigation Cluster */}
        <div className="flex flex-col gap-4">
          {/* Brand Insignia */}
          <div className="flex items-center gap-2.5 pb-2 border-b border-outline-variant/15">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-inverse-on-surface shadow-sm">
              <span
                className="material-symbols-outlined text-inverse-on-surface text-[20px]"
                data-icon="tsunami"
              >
                tsunami
              </span>
            </div>
            <div>
              <h1 className="text-base font-bold text-inverse-on-surface tracking-tight leading-none">
                FloodRelay Command
              </h1>
              <p className="text-[10px] font-mono font-medium text-surface-dim tracking-wider mt-0.5">
                OPERATOR PORTAL
              </p>
            </div>
          </div>

          {/* Dispatch Status Beacon */}
          <div className="px-2.5 py-1.5 rounded-lg bg-surface-variant/10 border border-outline-variant/15 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-fixed" />
              </span>
              <span className="text-[11px] font-mono font-bold text-inverse-on-surface tracking-tight">
                ONLINE - DELHI NCR
              </span>
            </div>
            <span className="text-[10px] font-mono text-primary-fixed font-bold">IST</span>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 mt-1">
            {/* Overview */}
            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isOverview
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={isOverview ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                dashboard
              </span>
              <span>Overview</span>
            </Link>

            {/* Rescue Requests */}
            <Link
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isRequests
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator/requests"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={isRequests ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  emergency
                </span>
                <span>Rescue Requests</span>
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-tertiary-container text-on-tertiary">
                19
              </span>
            </Link>

            {/* Operations Map */}
            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isMap
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator/map"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={isMap ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                map
              </span>
              <span>Operations Map</span>
            </Link>

            {/* Assignments */}
            <Link
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isAssignments
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator/assignments"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={isAssignments ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  assignment
                </span>
                <span>Assignments</span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary-fixed-dim text-on-primary-fixed">
                24 Active
              </span>
            </Link>

            {/* Operational Events */}
            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isEvents
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator/events"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={isEvents ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                radar
              </span>
              <span>Event Stream</span>
            </Link>

            {/* Audit Log */}
            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                isAudit
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10'
              }`}
              href="/operator/audit"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                style={isAudit ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                history
              </span>
              <span>Audit History</span>
            </Link>
          </nav>
        </div>

        {/* Footer Identity Block */}
        <div className="pt-3 border-t border-outline-variant/15 flex flex-col gap-2">
          <Link
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-surface-dim hover:text-inverse-on-surface hover:bg-surface-variant/10 transition-colors"
            href="/limitations"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="material-symbols-outlined text-[16px]">info</span>
            <span>Operational Limitations</span>
          </Link>

          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-surface-variant/5">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="material-symbols-outlined text-surface-dim text-[24px]">
                account_circle
              </span>
              <div className="flex flex-col truncate">
                <span className="text-xs font-semibold text-inverse-on-surface truncate">
                  {operator?.name || 'Authorized Operator'}
                </span>
                <span className="text-[10px] text-surface-dim font-mono truncate">
                  {operator?.role || 'OPERATOR'} • {operator?.username || 'operator'}
                </span>
              </div>
            </div>
            <button
              className="p-1 rounded text-surface-dim hover:text-white hover:bg-surface-variant/20 transition-colors"
              onClick={() => logout()}
              title="Log Out of Command Center"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
