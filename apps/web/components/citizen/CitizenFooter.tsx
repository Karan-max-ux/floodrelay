import React from 'react';
import Link from 'next/link';
import { getCitizenMessages } from '@/lib/i18n';
import { REGION_CONFIG } from '@/lib/region';

export function CitizenFooter() {
  const messages = getCitizenMessages();
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant mt-auto">
      <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Brand & Mission Statement */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left gap-1">
          <span className="font-manrope text-lg font-bold text-primary">FloodRelay</span>
          <p className="text-xs text-on-surface-variant max-w-md">
            {messages.emergency.footerGuidance}
          </p>
        </div>

        {/* Civic Emergency Resource Links */}
        <nav
          aria-label="Civic Emergency Resources"
          className="flex flex-wrap justify-center md:justify-end gap-x-6 gap-y-2 text-xs font-semibold text-on-surface-variant"
        >
          <Link
            href="/limitations"
            className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
          >
            Operational Limitations
          </Link>
          <a
            href={`tel:${REGION_CONFIG.emergencyNumber}`}
            className="text-on-surface-variant hover:text-primary transition-colors"
          >
            {`Emergency ${REGION_CONFIG.emergencyNumber}`}
          </a>
        </nav>
      </div>
    </footer>
  );
}
