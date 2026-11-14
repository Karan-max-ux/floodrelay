export type TileTheme = 'dark' | 'standard';

export interface TileConfig {
  url: string;
  attribution: string;
  className?: string;
  maxZoom: number;
}

export const DEFAULT_OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const DARK_TACTICAL_TILE_CLASS = 'dark-tactical-tiles';

/**
 * Pure helper providing basemap tile configuration for the Operator Tactical Map.
 * Uses public OpenStreetMap raster tiles by default (light standard view, optional dark mode).
 * Supports environment variable overrides for custom or self-hosted tile providers.
 */
export function getTileConfig(theme: TileTheme = 'standard'): TileConfig {
  const customUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  const customAttribution = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;

  const url = customUrl && customUrl.trim() !== '' ? customUrl : DEFAULT_OSM_TILE_URL;
  const attribution =
    customAttribution && customAttribution.trim() !== ''
      ? customAttribution
      : DEFAULT_OSM_ATTRIBUTION;

  return {
    url,
    attribution,
    className: theme === 'dark' ? DARK_TACTICAL_TILE_CLASS : undefined,
    maxZoom: 19,
  };
}
