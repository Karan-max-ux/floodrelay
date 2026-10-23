import { describe, expect, it } from 'vitest';
import { clusterRequests } from './dbscan.js';

describe('clusterRequests (DBSCAN)', () => {
  // Cluster A: around (28.600, 77.200) - 3 points within 300m of each other
  const clusterA = [
    { id: 'a1', lat: 28.6001, lng: 77.2001, peopleCount: 3 },
    { id: 'a2', lat: 28.6003, lng: 77.2002, peopleCount: 2 },
    { id: 'a3', lat: 28.5999, lng: 77.2003, peopleCount: 4 },
  ];

  // Cluster B: around (28.680, 77.280) - ~11 km away, 3 points within 300m
  const clusterB = [
    { id: 'b1', lat: 28.6801, lng: 77.2801, peopleCount: 5 },
    { id: 'b2', lat: 28.6802, lng: 77.2804, peopleCount: 1 },
    { id: 'b3', lat: 28.6798, lng: 77.2802, peopleCount: 6 },
  ];

  // Noise point: isolated outlier ~5 km from any cluster
  const noisePoint = { id: 'noise-1', lat: 28.64, lng: 77.24, peopleCount: 2 };

  it('correctly partitions two distinct spatial clusters with epsilon = 1000m', () => {
    const points = [...clusterA, ...clusterB];
    const result = clusterRequests(points, { epsilonMeters: 1000, minPoints: 3 });

    expect(result.coreClustersCount).toBe(2);
    expect(result.noiseUnitsCount).toBe(0);
    expect(result.clusters).toHaveLength(2);

    // Verify cluster sizes
    const sizes = result.clusters.map((c) => c.items.length).sort((a, b) => a - b);
    expect(sizes).toEqual([3, 3]);

    // Verify people counts
    const people = result.clusters.map((c) => c.totalPeopleCount).sort((a, b) => a - b);
    expect(people).toEqual([9, 12]);
  });

  it('DBSCAN keeps noise points as singleton demands', () => {
    const points = [...clusterA, ...clusterB, noisePoint];
    const result = clusterRequests(points, { epsilonMeters: 1000, minPoints: 3 });

    expect(result.coreClustersCount).toBe(2);
    expect(result.noiseUnitsCount).toBe(1);
    expect(result.clusters).toHaveLength(3); // 2 core clusters + 1 noise demand unit

    const noiseUnit = result.clusters.find((c) => c.isNoise);
    expect(noiseUnit).toBeDefined();
    expect(noiseUnit?.items).toHaveLength(1);
    expect(noiseUnit?.items[0]?.id).toBe('noise-1');
    expect(noiseUnit?.totalPeopleCount).toBe(2);
  });

  it('respects metric distance in meters (separates at 300m, merges at 800m)', () => {
    // Two points ~500m apart along latitude (1 deg lat ~ 111km -> 0.0045 deg ~ 500m)
    const p1 = { id: 'p1', lat: 28.6, lng: 77.2, peopleCount: 2 };
    const p2 = { id: 'p2', lat: 28.6045, lng: 77.2, peopleCount: 3 };
    const p3 = { id: 'p3', lat: 28.6022, lng: 77.2, peopleCount: 1 }; // In between

    // At epsilon = 200m, they cannot bridge to form a cluster
    const smallEps = clusterRequests([p1, p2, p3], { epsilonMeters: 200, minPoints: 2 });
    expect(smallEps.coreClustersCount).toBe(0);
    expect(smallEps.noiseUnitsCount).toBe(3);

    // At epsilon = 350m, p1 connects to p3, and p3 connects to p2 -> 1 merged cluster
    const largeEps = clusterRequests([p1, p2, p3], { epsilonMeters: 350, minPoints: 2 });
    expect(largeEps.coreClustersCount).toBe(1);
    expect(largeEps.noiseUnitsCount).toBe(0);
  });

  it('handles empty input gracefully', () => {
    const result = clusterRequests([], { epsilonMeters: 1000, minPoints: 3 });
    expect(result.clusters).toHaveLength(0);
    expect(result.coreClustersCount).toBe(0);
    expect(result.noiseUnitsCount).toBe(0);
  });
});
