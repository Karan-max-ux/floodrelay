import type {
  GeoPoint,
  HazardLevel,
  ResourceRoute,
  SolverPlan,
  ResourceType,
} from '@floodrelay/shared';
import { SeededRNG } from '../generator.js';
import type { TravelEstimate, TravelTimeProvider } from './travelTime.js';

export const ASSUMED_BASE_CV = 0.15; // placeholder, not measured
export const ASSUMED_WATER_DEPTH_CV_FACTOR = 0.2; // per meter of water; placeholder, not measured
export const ASSUMED_WEATHER_CV_FACTOR = 0.1; // per weather severity level (0-3); placeholder, not measured
export const ASSUMED_CONGESTION_CV_FACTOR = 0.15; // placeholder, not measured
export const ASSUMED_HAZARD_CV_WATER_SURGE = 0.3; // placeholder, not measured
export const ASSUMED_HAZARD_CV_CAUTION = 0.15; // placeholder, not measured

export type VehicleRoute = ResourceRoute;
export type RescuePlan = SolverPlan;

export interface UncertaintyFactors {
  waterDepthMeters?: number;
  weatherSeverity?: number; // 0 (clear) to 3 (extreme)
  congestionFactor?: number; // 0 (none) to 1 (heavy)
  hazardSeverity?: HazardLevel;
}

export interface RouteRiskOptions {
  samples?: number;
  correlationRho?: number; // 0 to 0.99, default 0.35
  seed?: number;
  shiftLimitMinutes?: number; // default 480 (8 hours)
  cv?: number;
  getLegCv?: (from: GeoPoint, to: GeoPoint, legIndex: number) => number;
}

export interface RouteRiskReport {
  vehicleId: string;
  plannedDurationMinutes: number;
  simulatedMeanDurationMinutes: number;
  p90DurationMinutes: number;
  p95DurationMinutes: number;
  bufferMinutes: number; // P95 - planned
  shiftLimitMinutes: number;
  shiftExceedanceProbability: number;
  isAtRisk: boolean;
}

export interface PlanRiskReport {
  totalPlannedDurationMinutes: number;
  totalP90DurationMinutes: number;
  totalP95DurationMinutes: number;
  totalBufferMinutes: number;
  atRiskRoutesCount: number;
  maxExceedanceProbability: number;
  isPlanAtRisk: boolean;
  routeReports: RouteRiskReport[];
}

/**
 * Computes combined coefficient of variation (CV = sigma / mean)
 * by combining individual uncertainty factors in quadrature:
 * cv_effective = sqrt(cv_base^2 + cv_depth^2 + cv_weather^2 + cv_congestion^2 + cv_hazard^2)
 * where:
 * - cv_base = ASSUMED_BASE_CV (0.15, placeholder, not measured)
 * - cv_depth = waterDepthMeters * ASSUMED_WATER_DEPTH_CV_FACTOR (0.20 per meter, placeholder, not measured)
 * - cv_weather = weatherSeverity * ASSUMED_WEATHER_CV_FACTOR (0.10 per severity level 0-3, placeholder, not measured)
 * - cv_congestion = congestionFactor * ASSUMED_CONGESTION_CV_FACTOR (0.15, placeholder, not measured)
 * - cv_hazard = ASSUMED_HAZARD_CV_WATER_SURGE (0.30 for WATER_SURGE or BLOCKED, placeholder, not measured)
 *             | ASSUMED_HAZARD_CV_CAUTION (0.15 for CAUTION, placeholder, not measured)
 *             | 0.0 (otherwise)
 * All terms represent heuristic uncalibrated estimates without empirical telemetry calibration.
 */
export function calculateCoefficientOfVariation(factors: UncertaintyFactors = {}): number {
  const base = ASSUMED_BASE_CV;
  const depth = (factors.waterDepthMeters ?? 0) * ASSUMED_WATER_DEPTH_CV_FACTOR;
  const weather = (factors.weatherSeverity ?? 0) * ASSUMED_WEATHER_CV_FACTOR;
  const congestion = (factors.congestionFactor ?? 0) * ASSUMED_CONGESTION_CV_FACTOR;

  let hazard = 0;
  if (factors.hazardSeverity === 'WATER_SURGE' || factors.hazardSeverity === 'BLOCKED') {
    hazard = ASSUMED_HAZARD_CV_WATER_SURGE;
  } else if (factors.hazardSeverity === 'CAUTION') {
    hazard = ASSUMED_HAZARD_CV_CAUTION;
  }

  const cvSquared =
    base * base + depth * depth + weather * weather + congestion * congestion + hazard * hazard;
  return Number(Math.sqrt(cvSquared).toFixed(4));
}

/**
 * Rational approximation of the inverse standard normal cumulative distribution function (probit).
 * Accurate to within a relative error of about 1.15e-9 (Peter J. Acklam algorithm).
 */
export function inverseNormalCDF(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
  }

  // Coefficients in rational approximations
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];

  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];

  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];

  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let r: number;

  if (p < pLow) {
    // Rational approximation for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }

  if (p <= pHigh) {
    // Rational approximation for central region
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }

  // Rational approximation for upper region
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

/**
 * Computes the p-th quantile of a lognormal distribution parameterized by its mean and CV.
 * E[X] = meanDuration, CV[X] = cv.
 */
export function lognormalQuantile(p: number, meanDuration: number, cv: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  if (meanDuration <= 0 || cv <= 0) return Math.max(0, meanDuration);

  const sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
  const muLn = Math.log(meanDuration) - 0.5 * sigmaLn * sigmaLn;

  const z = inverseNormalCDF(p);
  const val = Math.exp(muLn + sigmaLn * z);
  return Number(val.toFixed(2));
}

/**
 * RiskAwareTravelTimeProvider decorates an inner TravelTimeProvider by computing
 * a specified percentile (e.g. 95th percentile) of travel duration under lognormal uncertainty.
 */
export class RiskAwareTravelTimeProvider implements TravelTimeProvider {
  constructor(
    private readonly inner: TravelTimeProvider,
    private readonly cvOrCalculator:
      number | ((from: GeoPoint, to: GeoPoint) => number) = ASSUMED_BASE_CV,
    private readonly percentile = 0.95,
  ) {}

  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    const base = this.inner.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);

    const cv =
      typeof this.cvOrCalculator === 'function'
        ? this.cvOrCalculator(from, to)
        : this.cvOrCalculator;

    const riskDuration = lognormalQuantile(this.percentile, base.durationMinutes, cv);

    return {
      ...base,
      durationMinutes: riskDuration,
    };
  }

  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) =>
        this.getTravelEstimate(origin, dest, speedKmH, undefined, resourceType),
      ),
    );
  }
}

/**
 * Helper generating standard normal variate using Box-Muller transform from SeededRNG.
 */
class NormalGenerator {
  private hasSpare = false;
  private spare = 0;

  constructor(private readonly rng: SeededRNG) {}

  nextNormal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }

    let u = 0;
    while (u <= 1e-12) {
      u = this.rng.next();
    }
    const v = this.rng.next();

    const radius = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;

    this.spare = radius * Math.sin(theta);
    this.hasSpare = true;
    return radius * Math.cos(theta);
  }
}

interface GenericStopLike {
  lat: number;
  lng: number;
  estimatedArrivalMinutes?: number;
  arrivalMinutes?: number;
  departureMinutes?: number;
}

interface GenericRouteLike {
  resourceId?: string;
  vehicleId?: string;
  stops: GenericStopLike[];
  totalDurationMinutes: number;
}

/**
 * Monte Carlo risk assessment of route completion time under lognormally distributed,
 * spatially/temporally correlated leg durations.
 */
export function assessRouteRisk(
  route: ResourceRoute | GenericRouteLike,
  options: RouteRiskOptions = {},
): RouteRiskReport {
  const samples = options.samples ?? 1000;
  const rho = Math.max(0, Math.min(0.99, options.correlationRho ?? 0.35));
  const seed = options.seed ?? 42;
  const shiftLimit = options.shiftLimitMinutes ?? 480;
  const defaultCv = options.cv ?? ASSUMED_BASE_CV;
  const vehicleId = route.resourceId ?? (route as GenericRouteLike).vehicleId ?? 'unknown';

  const stops = route.stops as unknown as Array<Record<string, number | undefined>>;
  if (stops.length < 2) {
    const planned = route.totalDurationMinutes;
    return {
      vehicleId,
      plannedDurationMinutes: planned,
      simulatedMeanDurationMinutes: planned,
      p90DurationMinutes: planned,
      p95DurationMinutes: planned,
      bufferMinutes: 0,
      shiftLimitMinutes: shiftLimit,
      shiftExceedanceProbability: planned > shiftLimit ? 1 : 0,
      isAtRisk: planned > shiftLimit,
    };
  }

  // Calculate leg mean durations and lognormal parameters
  const legs: Array<{ mean: number; muLn: number; sigmaLn: number }> = [];
  let fixedServiceDuration = 0;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const arr = stop.arrivalMinutes ?? stop.estimatedArrivalMinutes ?? 0;
    const dep = stop.departureMinutes ?? arr;
    fixedServiceDuration += Math.max(0, dep - arr);
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]!;
    const to = stops[i + 1]!;
    const fromDep =
      from.departureMinutes ?? from.arrivalMinutes ?? from.estimatedArrivalMinutes ?? 0;
    const toArr = to.arrivalMinutes ?? to.estimatedArrivalMinutes ?? fromDep;
    const mean = Math.max(0.1, toArr - fromDep);

    const fromPt: GeoPoint = { lat: from.lat ?? 0, lng: from.lng ?? 0 };
    const toPt: GeoPoint = { lat: to.lat ?? 0, lng: to.lng ?? 0 };

    const cv = options.getLegCv ? options.getLegCv(fromPt, toPt, i) : defaultCv;

    const sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
    const muLn = Math.log(mean) - 0.5 * sigmaLn * sigmaLn;

    legs.push({ mean, muLn, sigmaLn });
  }

  const rng = new SeededRNG(seed);
  const normalGen = new NormalGenerator(rng);

  const sqrtRho = Math.sqrt(rho);
  const sqrtOneMinusRho = Math.sqrt(1 - rho);

  const simulatedTotals = new Float64Array(samples);
  let exceedanceCount = 0;
  let sumTotals = 0;

  for (let s = 0; s < samples; s++) {
    const commonShock = normalGen.nextNormal();
    let totalRouteTime = fixedServiceDuration;

    for (const leg of legs) {
      const indepShock = normalGen.nextNormal();
      const legShock = sqrtRho * commonShock + sqrtOneMinusRho * indepShock;
      const legDuration = Math.exp(leg.muLn + leg.sigmaLn * legShock);
      totalRouteTime += legDuration;
    }

    simulatedTotals[s] = totalRouteTime;
    sumTotals += totalRouteTime;
    if (totalRouteTime > shiftLimit) {
      exceedanceCount++;
    }
  }

  simulatedTotals.sort();

  const p90Index = Math.min(samples - 1, Math.floor(0.9 * samples));
  const p95Index = Math.min(samples - 1, Math.floor(0.95 * samples));

  const planned = route.totalDurationMinutes;
  const p90 = Number(simulatedTotals[p90Index]!.toFixed(2));
  const p95 = Number(simulatedTotals[p95Index]!.toFixed(2));
  const meanSim = Number((sumTotals / samples).toFixed(2));
  const exceedanceProb = Number((exceedanceCount / samples).toFixed(4));

  return {
    vehicleId,
    plannedDurationMinutes: planned,
    simulatedMeanDurationMinutes: meanSim,
    p90DurationMinutes: p90,
    p95DurationMinutes: p95,
    bufferMinutes: Number(Math.max(0, p95 - planned).toFixed(2)),
    shiftLimitMinutes: shiftLimit,
    shiftExceedanceProbability: exceedanceProb,
    isAtRisk: exceedanceProb > 0.05 || p95 > shiftLimit,
  };
}

/**
 * Monte Carlo risk assessment of an entire plan across all vehicle routes.
 */
export function assessPlanRisk(
  plan: SolverPlan | { routes: Array<ResourceRoute | GenericRouteLike> },
  options: RouteRiskOptions = {},
): PlanRiskReport {
  const routeReports: RouteRiskReport[] = plan.routes.map(
    (route: ResourceRoute | GenericRouteLike, idx: number) => {
      const seed = (options.seed ?? 42) + idx * 1009;
      return assessRouteRisk(route, { ...options, seed });
    },
  );

  const totalPlannedDurationMinutes = Number(
    routeReports
      .reduce((acc: number, r: RouteRiskReport) => acc + r.plannedDurationMinutes, 0)
      .toFixed(2),
  );
  const totalP90DurationMinutes = Number(
    routeReports
      .reduce((acc: number, r: RouteRiskReport) => acc + r.p90DurationMinutes, 0)
      .toFixed(2),
  );
  const totalP95DurationMinutes = Number(
    routeReports
      .reduce((acc: number, r: RouteRiskReport) => acc + r.p95DurationMinutes, 0)
      .toFixed(2),
  );
  const totalBufferMinutes = Number(
    (totalP95DurationMinutes - totalPlannedDurationMinutes).toFixed(2),
  );

  const atRiskRoutesCount = routeReports.filter((r: RouteRiskReport) => r.isAtRisk).length;
  const maxExceedanceProbability = Math.max(
    0,
    ...routeReports.map((r: RouteRiskReport) => r.shiftExceedanceProbability),
  );

  return {
    totalPlannedDurationMinutes,
    totalP90DurationMinutes,
    totalP95DurationMinutes,
    totalBufferMinutes,
    atRiskRoutesCount,
    maxExceedanceProbability,
    isPlanAtRisk: atRiskRoutesCount > 0,
    routeReports,
  };
}
