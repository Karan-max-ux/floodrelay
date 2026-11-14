'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { RescueRequest, BlockedZone, FloodForecastContext } from '@floodrelay/shared';
import type { AssignmentRecord } from '@/lib/api/types';
import type { StagedAsset, StagedShelter, SelectedMapEntity, MapLayers } from './LeafletMapCanvas';

const LeafletMapCanvas = dynamic(() => import('./LeafletMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center p-6 text-slate-700 font-inter">
      <div className="w-12 h-12 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin mb-4" />
      <div className="text-sm font-bold font-mono text-blue-700 tracking-wider">
        INITIALIZING GEOSPATIAL MAP ENGINE...
      </div>
      <div className="text-xs text-slate-500 font-mono mt-1">
        Loading OpenStreetMap standard tiles and route geometry overlay
      </div>
    </div>
  ),
});

interface LeafletMapWrapperProps {
  requests: RescueRequest[];
  stagedFleet: StagedAsset[];
  stagedShelters: StagedShelter[];
  selectedAssignment: AssignmentRecord | null;
  blockedZones?: BlockedZone[];
  repairRoutePolylines?: Array<{ resourceId: string; latlngs: [number, number][] }>;
  forecastContext?: FloodForecastContext | null;
  layers: MapLayers;
  urgencyFilter: string;
  selectedEntity: SelectedMapEntity;
  onSelectEntity: (entity: SelectedMapEntity) => void;
  tileTheme: 'dark' | 'standard';
  actionTrigger?: { type: 'fit' | 'center-critical' | 'zoom-in' | 'zoom-out'; id: number } | null;
}

export default function LeafletMapWrapper(props: LeafletMapWrapperProps) {
  return <LeafletMapCanvas {...props} />;
}
