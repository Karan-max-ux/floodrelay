import React from 'react';
import { getCitizenMessages } from '@/lib/i18n';
import { REGION_CONFIG } from '@/lib/region';

export function EmergencyBanner() {
  const messages = getCitizenMessages();
  return (
    <aside
      aria-label="Emergency warning"
      className="bg-tertiary-container text-on-tertiary px-4 py-2 text-center text-sm font-medium"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2">
        <div className="flex items-center gap-1.5 font-semibold">
          <span
            className="material-symbols-outlined text-[18px]"
            data-icon="warning"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            warning
          </span>
          <span>Immediate life-threatening danger?</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">{messages.emergency.bannerLabel}</span>
          <a
            className="inline-flex items-center gap-1 bg-surface-container-lowest text-tertiary px-2.5 py-0.5 rounded text-xs font-bold uppercase hover:bg-surface-container transition-colors"
            href={`tel:${REGION_CONFIG.emergencyNumber}`}
          >
            <span className="material-symbols-outlined text-[14px]" data-icon="call">
              call
            </span>
            <span>{messages.emergency.callCta}</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
