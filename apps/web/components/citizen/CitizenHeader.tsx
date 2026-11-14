'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function CitizenHeader() {
  const pathname = usePathname();

  return (
    <>
      <header className="bg-surface border-b border-outline-variant sticky top-0 z-40">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between h-16">
          {/* Logo & Civic Title */}
          <Link
            className="flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-primary rounded p-1"
            href="/citizen"
          >
            <div className="w-9 h-9 rounded bg-primary-container flex items-center justify-center text-on-primary">
              <span className="material-symbols-outlined text-[22px]" data-icon="water_damage">
                water_damage
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-manrope text-xl font-bold text-primary tracking-tight leading-none">
                FloodRelay
              </span>
              <span className="text-[10px] tracking-wider text-on-surface-variant uppercase mt-0.5 font-semibold">
                Delhi Flood Response • Prototype
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Cluster */}
          <nav aria-label="Desktop Primary" className="hidden md:flex items-center gap-6">
            <Link
              className={`text-sm font-semibold pb-0.5 transition-colors ${
                pathname === '/citizen'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
              href="/citizen"
            >
              Home
            </Link>
            <Link
              className={`text-sm font-semibold pb-0.5 transition-colors ${
                pathname === '/citizen/request'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
              href="/citizen/request"
            >
              New Request
            </Link>
            <span
              className="text-on-surface-variant/50 text-sm font-medium flex items-center gap-1.5 cursor-not-allowed"
              title="Request tracking integrates in Phase 3 Milestone 2"
            >
              <span>Track Status</span>
              <span className="text-[10px] bg-surface-container px-1.5 py-0.2 rounded border border-outline-variant/40">
                M2
              </span>
            </span>
          </nav>

          {/* Trailing Action */}
          <div className="flex items-center gap-3">
            <a
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-tertiary text-on-tertiary text-xs font-bold active:opacity-90 hover:bg-opacity-95 transition-opacity"
              href="tel:112"
            >
              <span className="material-symbols-outlined text-[16px]" data-icon="emergency">
                emergency
              </span>
              <span>Call 112</span>
            </a>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation Bar"
        className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 px-4 md:hidden bg-surface border-t border-outline-variant shadow-lg"
      >
        <Link
          aria-current={pathname === '/citizen' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-lg transition-transform ${
            pathname === '/citizen'
              ? 'bg-primary-container text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          href="/citizen"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            data-icon="home"
            style={pathname === '/citizen' ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            home
          </span>
          <span className="text-xs font-semibold mt-0.5">Home</span>
        </Link>
        <Link
          aria-current={pathname === '/citizen/request' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-lg transition-transform ${
            pathname === '/citizen/request'
              ? 'bg-primary-container text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container'
          }`}
          href="/citizen/request"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            data-icon="emergency_home"
            style={
              pathname === '/citizen/request' ? { fontVariationSettings: "'FILL' 1" } : undefined
            }
          >
            emergency_home
          </span>
          <span className="text-xs font-semibold mt-0.5">New Request</span>
        </Link>
      </nav>
    </>
  );
}
