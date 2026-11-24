'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  exact: boolean;
}

export const OPERATOR_NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/operator', icon: 'dashboard', exact: true },
  { label: 'Fleet', href: '/operator/fleet', icon: 'directions_boat', exact: false },
  { label: 'Requests', href: '/operator/requests', icon: 'emergency', exact: false },
  { label: 'Live Map', href: '/operator/map', icon: 'map', exact: false },
  { label: 'Assignments', href: '/operator/assignments', icon: 'assignment', exact: false },
  { label: 'Events', href: '/operator/events', icon: 'radar', exact: false },
  { label: 'Audit', href: '/operator/audit', icon: 'history', exact: false },
];

export function isItemActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OperatorTopNav() {
  const pathname = usePathname();
  const { operator, logout } = useOperatorAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile navigation on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Close mobile navigation on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setMobileNavOpen(false);
    }
  }, []);

  useEffect(() => {
    if (mobileNavOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen, handleKeyDown]);

  return (
    <>
      <header
        role="banner"
        className="sticky top-0 z-40 w-full h-14 bg-[#0A2540] text-white border-b border-[#1E3A5F] shadow-sm select-none"
      >
        <div className="w-full h-full px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-3">
          {/* Leading: Brand & Mobile Toggle */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              className="lg:hidden p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#0066CC]"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="operator-mobile-drawer"
            >
              <span className="material-symbols-outlined text-[22px]">
                {mobileNavOpen ? 'close' : 'menu'}
              </span>
            </button>

            {/* Brand Logo & Title */}
            <Link
              href="/operator"
              className="flex items-center gap-2.5 group focus:outline-hidden focus:ring-2 focus:ring-[#0066CC] rounded"
            >
              <div className="w-8 h-8 rounded-lg bg-[#0066CC] flex items-center justify-center text-white shadow-xs group-hover:bg-[#0055b3] transition-colors">
                <span className="material-symbols-outlined text-[20px]" data-icon="tsunami">
                  tsunami
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-white tracking-tight leading-none">
                  FloodRelay Command
                </span>
                <span className="text-[10px] font-mono font-medium text-slate-300 tracking-wider mt-0.5">
                  OPERATOR PORTAL
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Desktop Horizontal Navigation */}
          <nav
            aria-label="Operator Navigation"
            className="hidden lg:flex items-center gap-1 flex-1 justify-center max-w-3xl"
          >
            {OPERATOR_NAV_ITEMS.map((item) => {
              const active = isItemActive(pathname, item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#0066CC] ${
                    active
                      ? 'bg-[#0066CC] text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className="material-symbols-outlined text-[17px]"
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Trailing: Info, Operator Identity & Sign Out */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Operational Limitations Link */}
            <Link
              href="/limitations"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden xl:inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
              title="Operational Limitations & Decision-Support Scope"
            >
              <span className="material-symbols-outlined text-[15px]">info</span>
              <span>Limitations</span>
            </Link>

            {/* Operator Badge */}
            {operator && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-white/10 text-white rounded-md border border-white/10 text-xs font-medium">
                <span className="material-symbols-outlined text-slate-300 text-[16px]">
                  account_circle
                </span>
                <span className="font-semibold text-xs truncate max-w-[120px]">
                  {operator.name || 'Operator'}
                </span>
                <span className="text-[10px] font-mono text-slate-300 font-normal">
                  {`(${operator.role || 'OPERATOR'})`}
                </span>
              </div>
            )}

            {/* Sign Out Button */}
            <button
              type="button"
              onClick={() => logout()}
              title="Sign out of operator session"
              className="h-8 px-2.5 rounded-md border border-white/20 bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/15 hover:text-white transition-colors flex items-center gap-1 focus:outline-hidden focus:ring-2 focus:ring-[#0066CC]"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Accessible Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div
          id="operator-mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
          className="fixed inset-0 z-50 lg:hidden flex"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="relative w-72 max-w-[85vw] h-full bg-[#0A2540] text-white border-r border-[#1E3A5F] p-4 flex flex-col justify-between z-10 font-inter shadow-2xl select-none">
            <div className="flex flex-col gap-4">
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#1E3A5F]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#0066CC] flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-[20px]">tsunami</span>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white leading-tight block">
                      FloodRelay Command
                    </span>
                    <span className="text-[10px] font-mono text-slate-300 block">
                      OPERATOR PORTAL
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              {/* Navigation Links */}
              <nav aria-label="Mobile Operator Navigation" className="flex flex-col gap-1">
                {OPERATOR_NAV_ITEMS.map((item) => {
                  const active = isItemActive(pathname, item.href, item.exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-[#0066CC] text-white shadow-xs'
                          : 'text-slate-300 hover:text-white hover:bg-white/10'
                      }`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Drawer Footer */}
            <div className="pt-3 border-t border-[#1E3A5F] flex flex-col gap-2">
              <Link
                href="/limitations"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileNavOpen(false)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Operational Limitations</span>
              </Link>

              {operator && (
                <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="material-symbols-outlined text-slate-300 text-[22px]">
                      account_circle
                    </span>
                    <div className="flex flex-col truncate">
                      <span className="text-xs font-semibold text-white truncate">
                        {operator.name || 'Operator'}
                      </span>
                      <span className="text-[10px] text-slate-300 font-mono truncate">
                        {operator.role || 'OPERATOR'} • {operator.username || 'operator'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileNavOpen(false);
                      logout();
                    }}
                    title="Log Out of Command Center"
                    className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/15 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
