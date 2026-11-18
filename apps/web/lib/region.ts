/**
 * User-facing regional defaults. These are presentation settings, not a
 * geographical restriction on requests, solver scenarios, or persisted data.
 * Dates in APIs remain ISO 8601/UTC; only the display is localised.
 */
export const REGION_CONFIG = {
  code: 'IN-DL',
  label: 'Delhi NCR',
  floodplain: 'Delhi–Yamuna Floodplain',
  operatorTitle: 'Delhi Flood Operations Dashboard',
  locale: 'en-IN',
  timeZone: 'Asia/Kolkata',
  emergencyNumber: '112',
  defaultMapCentre: { lat: 28.6139, lng: 77.209 },
} as const;

type DateValue = string | number | Date;

function validDate(value: DateValue): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatRegionDate(value: DateValue): string {
  const date = validDate(value);
  if (!date) return 'Unknown';
  return new Intl.DateTimeFormat(REGION_CONFIG.locale, {
    timeZone: REGION_CONFIG.timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatRegionTime(value: DateValue, includeSeconds = false): string {
  const date = validDate(value);
  if (!date) return 'Unknown';
  const time = new Intl.DateTimeFormat(REGION_CONFIG.locale, {
    timeZone: REGION_CONFIG.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).format(date);
  return `${time} IST`;
}

export function formatRegionDateTime(value: DateValue): string {
  const date = validDate(value);
  if (!date) return 'Unknown';
  return `${formatRegionDate(date)} · ${formatRegionTime(date)}`;
}
