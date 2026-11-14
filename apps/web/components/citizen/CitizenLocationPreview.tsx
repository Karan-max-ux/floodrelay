'use client';

import React from 'react';
import dynamic from 'next/dynamic';

interface CitizenLocationPreviewProps {
  lat: number;
  lng: number;
  address?: string;
  source?: 'GPS' | 'GEOCODED' | 'MANUAL';
  accuracy?: number | null;
}

// Dynamically import the map canvas with SSR disabled
const CitizenLocationMap = dynamic(() => import('./CitizenLocationMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-48 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-slate-500 text-xs font-medium"
      data-testid="location-preview-loading"
    >
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
      <span>Loading interactive map preview...</span>
    </div>
  ),
});

export default function CitizenLocationPreview({
  lat,
  lng,
  address,
  source,
  accuracy,
}: CitizenLocationPreviewProps) {
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
      <div className="relative h-48 w-full">
        <CitizenLocationMap address={address} lat={lat} lng={lng} />
      </div>
      <div className="p-2.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-mono font-medium">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </span>
          {accuracy ? (
            <span className="text-slate-500 text-[11px]">(±{Math.round(accuracy)}m)</span>
          ) : null}
        </div>
        {source && (
          <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
            {source === 'GPS' ? 'GPS Fixed' : source === 'GEOCODED' ? 'Geocoded' : 'Custom'}
          </span>
        )}
      </div>
    </div>
  );
}
