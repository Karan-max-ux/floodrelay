import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  getTileConfig,
  DEFAULT_OSM_TILE_URL,
  DEFAULT_OSM_ATTRIBUTION,
  DARK_TACTICAL_TILE_CLASS,
} from '../components/operator/map/tileConfig';

describe('Operator Map Tile Configuration (tileConfig)', () => {
  const originalEnvUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  const originalEnvAttribution = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_MAP_TILE_URL;
    delete process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;
  });

  afterEach(() => {
    if (originalEnvUrl !== undefined) {
      process.env.NEXT_PUBLIC_MAP_TILE_URL = originalEnvUrl;
    } else {
      delete process.env.NEXT_PUBLIC_MAP_TILE_URL;
    }

    if (originalEnvAttribution !== undefined) {
      process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION = originalEnvAttribution;
    } else {
      delete process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;
    }
  });

  it('provides OpenStreetMap default url for dark theme with dark tactical CSS class', () => {
    const config = getTileConfig('dark');
    expect(config.url).toBe(DEFAULT_OSM_TILE_URL);
    expect(config.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(config.className).toBe(DARK_TACTICAL_TILE_CLASS);
    expect(config.maxZoom).toBe(19);
    expect(config.attribution).toBe(DEFAULT_OSM_ATTRIBUTION);
    expect(config.attribution).toContain('https://www.openstreetmap.org/copyright');
    expect(config.url).not.toContain('carto');
    expect(config.attribution).not.toContain('carto');
  });

  it('provides OpenStreetMap default url for standard theme with no CSS class', () => {
    const config = getTileConfig('standard');
    expect(config.url).toBe(DEFAULT_OSM_TILE_URL);
    expect(config.className).toBeUndefined();
    expect(config.maxZoom).toBe(19);
    expect(config.attribution).toBe(DEFAULT_OSM_ATTRIBUTION);
    expect(config.url).not.toContain('carto');
    expect(config.attribution).not.toContain('carto');
  });

  it('respects NEXT_PUBLIC_MAP_TILE_URL and NEXT_PUBLIC_MAP_TILE_ATTRIBUTION overrides for both themes', () => {
    process.env.NEXT_PUBLIC_MAP_TILE_URL = 'https://tiles.custom-emergency.org/{z}/{x}/{y}.png';
    process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION = '&copy; Custom Relief GIS Provider';

    const darkConfig = getTileConfig('dark');
    expect(darkConfig.url).toBe('https://tiles.custom-emergency.org/{z}/{x}/{y}.png');
    expect(darkConfig.attribution).toBe('&copy; Custom Relief GIS Provider');
    expect(darkConfig.className).toBe(DARK_TACTICAL_TILE_CLASS);

    const standardConfig = getTileConfig('standard');
    expect(standardConfig.url).toBe('https://tiles.custom-emergency.org/{z}/{x}/{y}.png');
    expect(standardConfig.attribution).toBe('&copy; Custom Relief GIS Provider');
    expect(standardConfig.className).toBeUndefined();
  });

  it('fails if cartocdn or carto.com appears in the LeafletMapCanvas component source', () => {
    const canvasPath = path.resolve(__dirname, '../components/operator/map/LeafletMapCanvas.tsx');
    const source = fs.readFileSync(canvasPath, 'utf8');

    expect(source.toLowerCase()).not.toContain('cartocdn');
    expect(source.toLowerCase()).not.toContain('carto.com');
  });

  it('fails if cartocdn or carto.com appears in the tileConfig source', () => {
    const configPath = path.resolve(__dirname, '../components/operator/map/tileConfig.ts');
    const source = fs.readFileSync(configPath, 'utf8');

    expect(source.toLowerCase()).not.toContain('cartocdn');
    expect(source.toLowerCase()).not.toContain('carto.com');
  });

  it('uses light standard OSM theme by default when no theme argument is passed', () => {
    const config = getTileConfig();
    expect(config.url).toBe(DEFAULT_OSM_TILE_URL);
    expect(config.className).toBeUndefined();
    expect(config.maxZoom).toBe(19);
    expect(config.attribution).toBe(DEFAULT_OSM_ATTRIBUTION);
  });

  it('asserts globals.css has exactly one rule block for the dark-tactical-tiles filter without targeting .leaflet-tile', () => {
    const globalsCssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(globalsCssPath, 'utf8');

    // Find rule blocks containing dark-tactical-tiles and filter:
    const ruleBlocks = cssContent
      .split('}')
      .map((block) => block.trim())
      .filter((block) => block.includes('dark-tactical-tiles') && block.includes('filter:'));

    expect(ruleBlocks).toHaveLength(1);

    const [selectorPart] = ruleBlocks[0].split('{');
    expect(selectorPart).toBeDefined();
    expect(selectorPart).toContain('.dark-tactical-tiles');
    expect(selectorPart).not.toContain('.leaflet-tile');
  });
});
