import type { GeoPoint } from '@floodrelay/shared';
import { haversineKm } from '../index.js';

export interface DBSCANOptions {
  epsilonMeters: number; // Search radius in meters
  minPoints: number; // Minimum number of points to form a core cluster
}

export interface ClusteredUnit<T> {
  clusterId: number;
  isNoise: boolean;
  centroid: GeoPoint;
  totalPeopleCount: number;
  items: T[];
}

export interface ClusteringResult<T> {
  clusters: ClusteredUnit<T>[];
  coreClustersCount: number;
  noiseUnitsCount: number;
}

/**
 * Custom metric DBSCAN spatial demand clustering algorithm.
 * Groups nearby rescue requests into cohesive demand clusters using exact geodesic
 * distances (in meters). Non-cluster points (noise) are converted into singleton demand
 * units so no citizen request is ever dropped.
 */
export function clusterRequests<T extends { lat: number; lng: number; peopleCount?: number }>(
  items: T[],
  options: DBSCANOptions,
): ClusteringResult<T> {
  const { epsilonMeters, minPoints } = options;
  const n = items.length;

  if (n === 0) {
    return {
      clusters: [],
      coreClustersCount: 0,
      noiseUnitsCount: 0,
    };
  }

  // Pre-calculate distance in meters using Haversine
  const distanceMeters = (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): number => {
    return haversineKm(a, b) * 1000;
  };

  // Find epsilon-neighbors for each point
  const neighbors: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    neighbors[i] = [];
    const itemI = items[i]!;
    for (let j = 0; j < n; j++) {
      if (distanceMeters(itemI, items[j]!) <= epsilonMeters) {
        neighbors[i]!.push(j);
      }
    }
  }

  const UNVISITED = 0;
  const VISITED = 1;
  const visited = new Uint8Array(n); // 0 = unvisited, 1 = visited
  const clusterAssignments = new Int32Array(n).fill(-2); // -2 = unassigned, -1 = noise, >=0 = clusterId

  let clusterCounter = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i] === VISITED) continue;
    visited[i] = VISITED;

    const currentNeighbors = neighbors[i]!;

    if (currentNeighbors.length < minPoints) {
      clusterAssignments[i] = -1; // Tentatively mark as noise
    } else {
      // Expand new cluster
      const currentClusterId = clusterCounter++;
      clusterAssignments[i] = currentClusterId;

      const queue = [...currentNeighbors];
      let queueIdx = 0;

      while (queueIdx < queue.length) {
        const neighborIdx = queue[queueIdx++]!;

        if (visited[neighborIdx] === UNVISITED) {
          visited[neighborIdx] = VISITED;
          const neighborNeighbors = neighbors[neighborIdx]!;
          if (neighborNeighbors.length >= minPoints) {
            for (const nn of neighborNeighbors) {
              if (!queue.includes(nn)) {
                queue.push(nn);
              }
            }
          }
        }

        // If not assigned to any cluster yet, assign to current cluster
        if (clusterAssignments[neighborIdx]! < 0) {
          clusterAssignments[neighborIdx] = currentClusterId;
        }
      }
    }
  }

  // Group items by clusterId
  const clustersMap = new Map<number, T[]>();
  const noiseItems: T[] = [];

  for (let i = 0; i < n; i++) {
    const cId = clusterAssignments[i]!;
    const item = items[i]!;

    if (cId >= 0) {
      if (!clustersMap.has(cId)) {
        clustersMap.set(cId, []);
      }
      clustersMap.get(cId)!.push(item);
    } else {
      noiseItems.push(item);
    }
  }

  const resultClusters: ClusteredUnit<T>[] = [];

  // 1. Process Core Clusters
  for (const [cId, clusterPoints] of clustersMap.entries()) {
    let sumLat = 0;
    let sumLng = 0;
    let totalPeople = 0;

    for (const pt of clusterPoints) {
      sumLat += pt.lat;
      sumLng += pt.lng;
      totalPeople += pt.peopleCount ?? 1;
    }

    resultClusters.push({
      clusterId: cId,
      isNoise: false,
      centroid: {
        lat: Number((sumLat / clusterPoints.length).toFixed(6)),
        lng: Number((sumLng / clusterPoints.length).toFixed(6)),
      },
      totalPeopleCount: totalPeople,
      items: clusterPoints,
    });
  }

  const coreClustersCount = resultClusters.length;

  // 2. Process Noise Points: Treat each noise point as its own singleton demand unit
  for (let idx = 0; idx < noiseItems.length; idx++) {
    const pt = noiseItems[idx]!;
    resultClusters.push({
      clusterId: -(idx + 1), // Distinct negative id for noise units
      isNoise: true,
      centroid: {
        lat: Number(pt.lat.toFixed(6)),
        lng: Number(pt.lng.toFixed(6)),
      },
      totalPeopleCount: pt.peopleCount ?? 1,
      items: [pt],
    });
  }

  return {
    clusters: resultClusters,
    coreClustersCount,
    noiseUnitsCount: noiseItems.length,
  };
}
