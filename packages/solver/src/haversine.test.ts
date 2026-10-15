import { describe, expect, it } from 'vitest';
import { haversineKm, type GeoPoint } from './index.js';

describe('haversineKm', () => {
  const p1: GeoPoint = { lat: 28.6139, lng: 77.209 };
  const p2: GeoPoint = { lat: 19.076, lng: 72.8777 };
  const p3: GeoPoint = { lat: 12.9716, lng: 77.5946 };

  it('distance of a point to itself is 0', () => {
    expect(haversineKm(p1, p1)).toBe(0);
    expect(haversineKm(p2, p2)).toBe(0);
    expect(haversineKm(p3, p3)).toBe(0);
  });

  it('distance is symmetric', () => {
    const d12 = haversineKm(p1, p2);
    const d21 = haversineKm(p2, p1);
    expect(d12).toBeCloseTo(d21, 6);

    const d23 = haversineKm(p2, p3);
    const d32 = haversineKm(p3, p2);
    expect(d23).toBeCloseTo(d32, 6);
  });

  it('triangle inequality holds for three sample points', () => {
    const d12 = haversineKm(p1, p2);
    const d23 = haversineKm(p2, p3);
    const d13 = haversineKm(p1, p3);

    expect(d13).toBeLessThanOrEqual(d12 + d23 + 1e-9);
    expect(d12).toBeLessThanOrEqual(d13 + d23 + 1e-9);
    expect(d23).toBeLessThanOrEqual(d12 + d13 + 1e-9);
  });
});
