import type { GeoPoint, RescueRequest } from '@floodrelay/shared';

export type { GeoPoint };

const EARTH_RADIUS_KM = 6371.0;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLng = Math.sin(dLng / 2);

  const h = sinHalfDLat * sinHalfDLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfDLng * sinHalfDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export function requestDistanceKm(a: RescueRequest, b: RescueRequest): number {
  return haversineKm(a, b);
}

export * from './generator.js';
export * from './metrics.js';
export * from './routing/travelTime.js';
export * from './baselines/nearestFirst.js';
export * from './clustering/dbscan.js';
export * from './heuristics/clusterAllocation.js';
export * from './baselines/clarkeWrightBaseline.js';
export * from './evaluation/benchmark.js';
