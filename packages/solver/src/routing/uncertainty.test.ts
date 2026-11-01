import { describe, it, expect } from 'vitest';
import type { ResourceRoute, SolverPlan } from '@floodrelay/shared';
import {
  calculateCoefficientOfVariation,
  inverseNormalCDF,
  lognormalQuantile,
  RiskAwareTravelTimeProvider,
  assessRouteRisk,
  assessPlanRisk,
  ASSUMED_BASE_CV,
} from './uncertainty.js';
import { StraightLineTravelTimeProvider } from './travelTime.js';

describe('Uncertainty Modeling & Risk Assessment', () => {
  describe('calculateCoefficientOfVariation', () => {
    it('returns base CV when no external factors are present', () => {
      const cv = calculateCoefficientOfVariation({});
      expect(cv).toBe(ASSUMED_BASE_CV);
    });

    it('combines factors in quadrature', () => {
      // base=0.15, depth 1m = 0.2, weather 2 = 0.2, hazard WATER_SURGE = 0.3
      // sqrt(0.15^2 + 0.2^2 + 0.2^2 + 0.3^2) = sqrt(0.0225 + 0.04 + 0.04 + 0.09) = sqrt(0.1925) = 0.4387
      const cv = calculateCoefficientOfVariation({
        waterDepthMeters: 1.0,
        weatherSeverity: 2,
        hazardSeverity: 'WATER_SURGE',
      });
      expect(cv).toBeCloseTo(0.4387, 3);
    });
  });

  describe('inverseNormalCDF & lognormalQuantile', () => {
    it('computes accurate standard normal quantiles', () => {
      expect(inverseNormalCDF(0.5)).toBeCloseTo(0.0, 5);
      expect(inverseNormalCDF(0.8413447)).toBeCloseTo(1.0, 4);
      expect(inverseNormalCDF(0.9772498)).toBeCloseTo(2.0, 4);
      expect(inverseNormalCDF(0.0227501)).toBeCloseTo(-2.0, 4);
      expect(inverseNormalCDF(0.95)).toBeCloseTo(1.64485, 4);
    });

    it('computes inverseNormalCDF matching expected benchmark quantiles within 1e-6 tolerance', () => {
      expect(inverseNormalCDF(0.5)).toBeCloseTo(0.0, 6);
      expect(inverseNormalCDF(0.8)).toBeCloseTo(0.841621, 6);
      expect(inverseNormalCDF(0.95)).toBeCloseTo(1.644854, 6);
      expect(inverseNormalCDF(0.975)).toBeCloseTo(1.959964, 6);
      expect(inverseNormalCDF(0.99)).toBeCloseTo(2.326348, 6);
    });

    it('satisfies inverseNormalCDF symmetry z(1 - p) = -z(p) and boundary conditions', () => {
      const testPValues = [0.001, 0.01, 0.05, 0.1, 0.2, 0.35, 0.49];
      for (const p of testPValues) {
        expect(inverseNormalCDF(1 - p)).toBeCloseTo(-inverseNormalCDF(p), 6);
      }

      // Edge cases
      expect(inverseNormalCDF(0)).toBe(-Infinity);
      expect(inverseNormalCDF(1)).toBe(Infinity);
      expect(inverseNormalCDF(-0.5)).toBe(-Infinity);
      expect(inverseNormalCDF(1.5)).toBe(Infinity);
    });

    it('verifies lognormalQuantile median (p=0.5) equals exp(mu)', () => {
      const testCases = [
        { mean: 30, cv: 0.15 },
        { mean: 50, cv: 0.25 },
        { mean: 120, cv: 0.4 },
      ];

      for (const { mean, cv } of testCases) {
        const sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
        const muLn = Math.log(mean) - 0.5 * sigmaLn * sigmaLn;
        const expectedMedian = Number(Math.exp(muLn).toFixed(2));

        const computedMedian = lognormalQuantile(0.5, mean, cv);
        expect(computedMedian).toBeCloseTo(expectedMedian, 2);
        expect(computedMedian).toBeCloseTo(Math.exp(muLn), 2);
      }
    });

    it('lognormalQuantile preserves strict monotonic ordering across percentiles', () => {
      const mean = 60; // 60 minutes
      const cv = 0.3;

      const q10 = lognormalQuantile(0.1, mean, cv);
      const q50 = lognormalQuantile(0.5, mean, cv);
      const q90 = lognormalQuantile(0.9, mean, cv);
      const q95 = lognormalQuantile(0.95, mean, cv);
      const q99 = lognormalQuantile(0.99, mean, cv);

      expect(q10).toBeLessThan(q50);
      expect(q50).toBeLessThan(mean); // For lognormal, median is exp(mu - 0.5*sigma^2) < mean
      expect(q50).toBeLessThan(q90);
      expect(q90).toBeLessThan(q95);
      expect(q95).toBeLessThan(q99);
    });

    it('returns planned mean when CV is zero', () => {
      expect(lognormalQuantile(0.95, 45, 0)).toBe(45);
    });
  });

  describe('RiskAwareTravelTimeProvider', () => {
    it('decorates provider to scale travel duration to risk percentile', () => {
      const base = new StraightLineTravelTimeProvider();
      const p1 = { lat: 28.6, lng: 77.2 };
      const p2 = { lat: 28.7, lng: 77.3 };

      const baseEst = base.getTravelEstimate(p1, p2);
      const riskProvider = new RiskAwareTravelTimeProvider(base, 0.25, 0.95);
      const riskEst = riskProvider.getTravelEstimate(p1, p2);

      expect(riskEst.distanceKm).toBe(baseEst.distanceKm);
      expect(riskEst.durationMinutes).toBeGreaterThan(baseEst.durationMinutes);
      expect(riskEst.durationMinutes).toBeCloseTo(
        lognormalQuantile(0.95, baseEst.durationMinutes, 0.25),
        2,
      );
    });
  });

  describe('assessRouteRisk & assessPlanRisk', () => {
    const sampleRoute: ResourceRoute = {
      resourceId: 'boat-alpha',
      totalDurationMinutes: 120,
      totalTravelDistanceKm: 35,
      servedRequestIds: ['r1', 'r2'],
      stops: [
        {
          stopNumber: 1,
          type: 'DEPOT',
          targetId: 'depot-0',
          lat: 28.6,
          lng: 77.2,
          passengersPickedUp: 0,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 0,
        },
        {
          stopNumber: 2,
          type: 'PICKUP',
          targetId: 'r1',
          lat: 28.65,
          lng: 77.25,
          passengersPickedUp: 2,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 30,
        },
        {
          stopNumber: 3,
          type: 'PICKUP',
          targetId: 'r2',
          lat: 28.7,
          lng: 77.3,
          passengersPickedUp: 3,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: 70,
        },
        {
          stopNumber: 4,
          type: 'DROPOFF',
          targetId: 'sh1',
          lat: 28.75,
          lng: 77.35,
          passengersPickedUp: 0,
          passengersDroppedOff: 5,
          estimatedArrivalMinutes: 120,
        },
      ],
    };

    it('preserves mean duration over large Monte Carlo sample', () => {
      const report = assessRouteRisk(sampleRoute, { samples: 5000, seed: 12345, cv: 0.2 });
      expect(report.simulatedMeanDurationMinutes).toBeCloseTo(120, -1);
      expect(report.p95DurationMinutes).toBeGreaterThan(report.p90DurationMinutes);
      expect(report.p90DurationMinutes).toBeGreaterThan(report.simulatedMeanDurationMinutes);
    });

    it('reproduces identical results when using the same seed', () => {
      const r1 = assessRouteRisk(sampleRoute, { samples: 1000, seed: 999 });
      const r2 = assessRouteRisk(sampleRoute, { samples: 1000, seed: 999 });

      expect(r1.p90DurationMinutes).toBe(r2.p90DurationMinutes);
      expect(r1.p95DurationMinutes).toBe(r2.p95DurationMinutes);
      expect(r1.bufferMinutes).toBe(r2.bufferMinutes);
      expect(r1.simulatedMeanDurationMinutes).toBe(r2.simulatedMeanDurationMinutes);
      expect(r1.shiftExceedanceProbability).toBe(r2.shiftExceedanceProbability);
    });

    it('demonstrates that inter-leg correlation widens the tail (higher P95)', () => {
      // Uncorrelated legs (rho = 0): law of large numbers averages out leg variances
      const uncorrelated = assessRouteRisk(sampleRoute, {
        samples: 4000,
        seed: 42,
        correlationRho: 0.0,
        cv: 0.35,
      });

      // Strongly correlated legs (rho = 0.85): all legs suffer high delay together in bad scenarios
      const correlated = assessRouteRisk(sampleRoute, {
        samples: 4000,
        seed: 42,
        correlationRho: 0.85,
        cv: 0.35,
      });

      expect(correlated.p95DurationMinutes).toBeGreaterThan(uncorrelated.p95DurationMinutes);
      expect(correlated.bufferMinutes).toBeGreaterThan(uncorrelated.bufferMinutes);
    });

    it('flags routes and plans exceeding shift limits as at-risk', () => {
      // Set shift limit very tight (e.g. 115 minutes when planned travel time is 120 mins)
      const report = assessRouteRisk(sampleRoute, {
        shiftLimitMinutes: 115,
        samples: 1000,
        seed: 42,
        cv: 0.25,
      });

      expect(report.shiftExceedanceProbability).toBeGreaterThan(0.05);
      expect(report.isAtRisk).toBe(true);
    });

    it('evaluates entire plan risk in assessPlanRisk', () => {
      const plan: SolverPlan = {
        scenarioId: 'sc-1',
        calculatedAt: new Date().toISOString(),
        routes: [sampleRoute],
        unserved: [],
        metrics: {
          totalTravelTimeMinutes: 120,
          totalTravelDistanceKm: 35,
          highPriorityWaitTimeMinutes: 0,
          solveDurationMs: 2,
          servedRequestsCount: 2,
          unservedRequestsCount: 0,
          coveragePercent: 100,
        },
      };

      const planReport = assessPlanRisk(plan, { shiftLimitMinutes: 480 });
      expect(planReport.routeReports).toHaveLength(1);
      expect(planReport.totalPlannedDurationMinutes).toBe(120);
      expect(planReport.totalP95DurationMinutes).toBeGreaterThan(120);
      expect(planReport.totalBufferMinutes).toBeGreaterThan(0);
      expect(planReport.isPlanAtRisk).toBe(false); // 120 < 480
    });
  });
});
