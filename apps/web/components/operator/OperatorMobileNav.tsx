'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface OperatorMobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OperatorMobileNav({ isOpen, onClose }: OperatorMobileNavProps) {
  const pathname = usePathname();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={onClose} />

      {/* Drawer */}
      <aside className="relative w-64 max-w-[80%] h-full bg-inverse-surface border-r border-outline-variant/20 p-4 flex flex-col justify-between z-10 font-inter">
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-outline-variant/15">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-inverse-on-surface">
                <span className="material-symbols-outlined text-[20px]">tsunami</span>
              </div>
              <div>
                <h2 className="text-sm font-bold text-inverse-on-surface leading-tight">
                  FloodRelay Command
                </h2>
                <p className="text-[10px] font-mono text-surface-dim">OPERATOR PORTAL</p>
              </div>
            </div>
            <button
              className="text-surface-dim hover:text-inverse-on-surface p-1"
              onClick={onClose}
              type="button"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname === '/operator'
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">dashboard</span>
              <span>Overview</span>
            </Link>

            <Link
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname.startsWith('/operator/requests')
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator/requests"
              onClick={onClose}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">emergency</span>
                <span>Rescue Requests</span>
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-tertiary-container text-on-tertiary">
                19
              </span>
            </Link>

            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname.startsWith('/operator/map')
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator/map"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">map</span>
              <span>Operations Map</span>
            </Link>

            <Link
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname.startsWith('/operator/assignments')
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator/assignments"
              onClick={onClose}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">assignment</span>
                <span>Assignments</span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary-fixed-dim text-on-primary-fixed">
                24 Active
              </span>
            </Link>

            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname.startsWith('/operator/events')
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator/events"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">radar</span>
              <span>Event Stream</span>
            </Link>

            <Link
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                pathname.startsWith('/operator/audit')
                  ? 'bg-primary text-on-primary'
                  : 'text-surface-dim hover:bg-surface-variant/10'
              }`}
              href="/operator/audit"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">history</span>
              <span>Audit History</span>
            </Link>

            <Link
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-surface-dim hover:bg-surface-variant/10"
              href="/limitations"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">info</span>
              <span>Operational Limitations</span>
            </Link>
          </nav>
        </div>

        <div className="pt-3 border-t border-outline-variant/15 text-xs text-surface-dim flex items-center justify-between">
          <span>Delhi Operations Centre</span>
          <span className="font-mono text-primary-fixed text-[10px] font-bold">ONLINE</span>
        </div>
      </aside>
    </div>
  );
}
