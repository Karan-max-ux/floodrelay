'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';

interface OperatorHeaderProps {
  onToggleMobileNav?: () => void;
}

export function OperatorHeader({ onToggleMobileNav }: OperatorHeaderProps) {
  const pathname = usePathname();
  const { operator, logout } = useOperatorAuth();

  let pageTitle = 'Delhi Operations Overview';
  let subRoute = '/operator';

  if (pathname.startsWith('/operator/requests')) {
    pageTitle = 'Rescue Request Management';
    subRoute = '/operator/requests';
  } else if (pathname.startsWith('/operator/map')) {
    pageTitle = 'Delhi Response Map';
    subRoute = '/operator/map';
  } else if (pathname.startsWith('/operator/assignments/')) {
    pageTitle = 'Assignment Inspection & Human Commit';
    subRoute = pathname;
  } else if (pathname.startsWith('/operator/assignments')) {
    pageTitle = 'Resource Assignment & Dispatch Planning';
    subRoute = '/operator/assignments';
  }

  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 h-14 z-30 bg-surface-container-lowest border-b border-outline-variant shadow-xs flex items-center justify-between px-4 lg:px-6">
      {/* Leading Section: Mobile Toggle & Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          className="lg:hidden p-1.5 rounded-lg text-on-surface hover:bg-surface-container"
          onClick={onToggleMobileNav}
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        <div className="flex items-center gap-2 overflow-hidden">
          <Link
            className="text-sm font-bold text-on-surface hover:text-primary transition-colors truncate"
            href="/operator"
          >
            FloodRelay Command
          </Link>
          <span className="text-outline text-xs">/</span>
          <span className="text-xs font-semibold text-primary truncate max-w-[180px] sm:max-w-none">
            {pageTitle}
          </span>
          <span className="hidden xl:inline-block font-mono text-[10px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/40">
            {subRoute}
          </span>
        </div>
      </div>

      {/* Trailing Section: Operator Identity & Actions */}
      <div className="flex items-center gap-3">
        {/* Operator Badge */}
        {operator && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-surface-container text-on-surface border border-outline-variant/50 rounded-lg text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{operator.name}</span>
            <span className="text-[10px] font-mono text-on-surface-variant font-normal">
              ({operator.role})
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            className="h-8 px-2.5 rounded border border-outline-variant bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-1"
            onClick={() => logout()}
            title="Sign out of operator session"
            type="button"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
