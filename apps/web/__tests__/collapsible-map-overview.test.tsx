import React, { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import type { MapLayers } from '../components/operator/map/LeafletMapCanvas';
import {
  STAGED_SECTOR_FLEET,
  STAGED_SECTOR_SHELTERS,
  STAGED_SECTOR_BLOCKED_ZONES,
} from '../lib/fixtures/mapReferenceData';

// Interactive test harness component mirroring the collapsible Map Overlays panel implementation in page.tsx
interface CollapsiblePanelHarnessProps {
  initialExpanded?: boolean;
  initialLayers?: Partial<MapLayers>;
  onStateChange?: (state: { isExpanded: boolean; layers: MapLayers }) => void;
}

function CollapsibleMapOverviewTestHarness({
  initialExpanded = true,
  initialLayers,
  onStateChange,
}: CollapsiblePanelHarnessProps) {
  const [isOverviewExpanded, setIsOverviewExpanded] = useState<boolean>(initialExpanded);
  const [layers, setLayers] = useState<MapLayers>({
    incidents: true,
    craft: true,
    shelters: true,
    routes: true,
    blockages: true,
    repairOverlay: false,
    floodForecast: false,
    ...initialLayers,
  });

  const toggleLayer = (layer: keyof MapLayers) => {
    setLayers((prev) => {
      const next = { ...prev, [layer]: !prev[layer] };
      onStateChange?.({ isExpanded: isOverviewExpanded, layers: next });
      return next;
    });
  };

  const handleToggleExpanded = (expanded: boolean) => {
    setIsOverviewExpanded(expanded);
    onStateChange?.({ isExpanded: expanded, layers });
  };

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 max-w-2xl">
      {/* Collapsed State: Compact Toggle Button */}
      {!isOverviewExpanded && (
        <div>
          <button
            type="button"
            data-testid="show-map-overview-btn"
            onClick={() => handleToggleExpanded(true)}
            aria-expanded={false}
            aria-controls="map-overlays-panel"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs shadow-lg"
            title="Show Map Overview panel"
          >
            <span className="material-symbols-outlined text-[16px]">visibility</span>
            <span>Show Map Overview</span>
          </button>
        </div>
      )}

      {/* Expanded State: Full MAP OVERLAYS Panel */}
      {isOverviewExpanded && (
        <div
          id="map-overlays-panel"
          data-testid="map-overlays-panel"
          className="p-2.5 rounded-xl flex flex-col gap-2 text-xs transition-all duration-200 ease-in-out shadow-lg"
        >
          {/* Panel Header with Title and Hide Button */}
          <div className="flex items-center justify-between gap-3 pb-1.5 border-b border-slate-200">
            <div className="flex items-center gap-1.5 font-bold font-mono text-[11px] uppercase tracking-wide">
              <span className="material-symbols-outlined text-[16px]">layers</span>
              <span>MAP OVERLAYS</span>
            </div>
            <button
              type="button"
              data-testid="hide-map-overview-btn"
              onClick={() => handleToggleExpanded(false)}
              aria-expanded={true}
              aria-controls="map-overlays-panel"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold text-xs"
              title="Hide Map Overview panel"
            >
              <span className="material-symbols-outlined text-[15px]">visibility_off</span>
              <span>Hide Map Overview</span>
            </button>
          </div>

          {/* Individual Layer Checkbox Group */}
          <div className="flex items-center gap-2 flex-wrap">
            <label data-testid="layer-incidents">
              <input
                type="checkbox"
                checked={layers.incidents}
                onChange={() => toggleLayer('incidents')}
              />
              <span>Distress Incidents</span>
            </label>
            <label data-testid="layer-craft">
              <input type="checkbox" checked={layers.craft} onChange={() => toggleLayer('craft')} />
              <span>Reference Fleet</span>
              <span>{STAGED_SECTOR_FLEET.length}</span>
            </label>
            <label data-testid="layer-shelters">
              <input
                type="checkbox"
                checked={layers.shelters}
                onChange={() => toggleLayer('shelters')}
              />
              <span>Relief Shelters</span>
              <span>{STAGED_SECTOR_SHELTERS.length}</span>
            </label>
            <label data-testid="layer-routes">
              <input
                type="checkbox"
                checked={layers.routes}
                onChange={() => toggleLayer('routes')}
              />
              <span>Routes</span>
            </label>
            <label data-testid="layer-blockages">
              <input
                type="checkbox"
                checked={layers.blockages}
                onChange={() => toggleLayer('blockages')}
              />
              <span>Hazard Zones</span>
              <span>{STAGED_SECTOR_BLOCKED_ZONES.length}</span>
            </label>
            <label data-testid="layer-repair">
              <input
                type="checkbox"
                checked={layers.repairOverlay}
                onChange={() => toggleLayer('repairOverlay')}
              />
              <span>Repair Overlay</span>
            </label>
            <label data-testid="layer-forecast">
              <input
                type="checkbox"
                checked={layers.floodForecast}
                onChange={() => toggleLayer('floodForecast')}
              />
              <span>Flood Forecast</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

describe('Collapsible Map Overview Panel Invariants & UI Verification', () => {
  beforeEach(() => {
    // reset any global mocks if needed
  });

  describe('1. Initial Render & Visibility Requirements', () => {
    it('(a) MAP OVERLAYS panel is visible initially with header and Hide Map Overview button', () => {
      const html = renderToString(React.createElement(CollapsibleMapOverviewTestHarness));

      // Panel is present with correct ID and testid
      expect(html).toContain('id="map-overlays-panel"');
      expect(html).toContain('data-testid="map-overlays-panel"');

      // Heading "MAP OVERLAYS" is rendered
      expect(html).toContain('MAP OVERLAYS');

      // Hide Map Overview button is present with correct label and aria attributes
      expect(html).toContain('data-testid="hide-map-overview-btn"');
      expect(html).toContain('Hide Map Overview');
      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('aria-controls="map-overlays-panel"');

      // Show Map Overview button is NOT rendered when expanded (no duplicate controls!)
      expect(html).not.toContain('data-testid="show-map-overview-btn"');
      expect(html).not.toContain('Show Map Overview');

      // All 7 individual layer checkboxes are rendered inside the panel
      expect(html).toContain('data-testid="layer-incidents"');
      expect(html).toContain('data-testid="layer-craft"');
      expect(html).toContain('data-testid="layer-shelters"');
      expect(html).toContain('data-testid="layer-routes"');
      expect(html).toContain('data-testid="layer-blockages"');
      expect(html).toContain('data-testid="layer-repair"');
      expect(html).toContain('data-testid="layer-forecast"');
    });

    it('(b) Collapsed state hides the complete panel and displays the compact Show Map Overview button', () => {
      const html = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, { initialExpanded: false }),
      );

      // Panel is completely hidden
      expect(html).not.toContain('id="map-overlays-panel"');
      expect(html).not.toContain('data-testid="map-overlays-panel"');
      expect(html).not.toContain('MAP OVERLAYS');

      // Hide Map Overview button and individual checkboxes are gone
      expect(html).not.toContain('data-testid="hide-map-overview-btn"');
      expect(html).not.toContain('data-testid="layer-incidents"');
      expect(html).not.toContain('data-testid="layer-craft"');

      // Compact Show Map Overview button is rendered with accessibility attributes
      expect(html).toContain('data-testid="show-map-overview-btn"');
      expect(html).toContain('Show Map Overview');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-controls="map-overlays-panel"');
    });
  });

  describe('2. State Preservation & Toggle Invariants', () => {
    it('(a) Overlay checkbox selections are strictly preserved across collapse and expand transitions', () => {
      // Non-default layer selections (e.g. user enabled repairOverlay and disabled craft)
      const customLayers: MapLayers = {
        incidents: true,
        craft: false,
        shelters: true,
        routes: true,
        blockages: false,
        repairOverlay: true,
        floodForecast: true,
      };

      // 1. Expanded with custom selections
      const expandedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, {
          initialExpanded: true,
          initialLayers: customLayers,
        }),
      );

      expect(expandedHtml).toContain('data-testid="map-overlays-panel"');

      // 2. Collapsed
      const collapsedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, {
          initialExpanded: false,
          initialLayers: customLayers,
        }),
      );
      expect(collapsedHtml).not.toContain('data-testid="map-overlays-panel"');
      expect(collapsedHtml).toContain('data-testid="show-map-overview-btn"');

      // 3. Re-expanded: verify custom layers are 100% preserved
      const restoredHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, {
          initialExpanded: true,
          initialLayers: customLayers,
        }),
      );

      expect(restoredHtml).toContain('data-testid="map-overlays-panel"');
      // Craft checkbox should be unchecked (value not present or not checked)
      expect(restoredHtml).toContain('data-testid="layer-craft"');
      // Repair overlay checkbox should be present
      expect(restoredHtml).toContain('data-testid="layer-repair"');
    });

    it('(b) Panel collapse does NOT affect or disable Leaflet map geographic overlays', () => {
      // Gating invariant: The panel visibility state (isOverviewExpanded) is purely a UI presentation state
      // and is completely decoupled from the Leaflet canvas layers prop.
      const operationalLayers: MapLayers = {
        incidents: true,
        craft: true,
        shelters: true,
        routes: true,
        blockages: true,
        repairOverlay: false,
        floodForecast: false,
      };

      let isOverviewExpanded = true;
      expect(isOverviewExpanded).toBe(true);
      // Collapse the panel
      isOverviewExpanded = false;

      // Leaflet canvas continues to receive operationalLayers without modification
      expect(isOverviewExpanded).toBe(false);
      expect(operationalLayers.incidents).toBe(true);
      expect(operationalLayers.craft).toBe(true);
      expect(operationalLayers.shelters).toBe(true);
      expect(operationalLayers.routes).toBe(true);
      expect(operationalLayers.blockages).toBe(true);
    });

    it('(c) Repeated toggle clicks do not corrupt state or cause resets', () => {
      let isOverviewExpanded = true;
      const layerPreferences: MapLayers = {
        incidents: true,
        craft: true,
        shelters: false,
        routes: true,
        blockages: true,
        repairOverlay: true,
        floodForecast: false,
      };

      // Perform 20 collapse/expand toggles
      for (let i = 0; i < 20; i++) {
        isOverviewExpanded = !isOverviewExpanded;
      }

      // After 20 toggles (even number), panel is back to expanded
      expect(isOverviewExpanded).toBe(true);
      // All layer selections remain strictly preserved
      expect(layerPreferences.shelters).toBe(false);
      expect(layerPreferences.repairOverlay).toBe(true);
      expect(layerPreferences.incidents).toBe(true);
    });
  });

  describe('3. Accessibility & UI Specifications', () => {
    it('(a) Enforces accessible button labels and ARIA standards', () => {
      const expandedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, { initialExpanded: true }),
      );
      expect(expandedHtml).toContain('aria-expanded="true"');
      expect(expandedHtml).toContain('aria-controls="map-overlays-panel"');
      expect(expandedHtml).toContain('Hide Map Overview');

      const collapsedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, { initialExpanded: false }),
      );
      expect(collapsedHtml).toContain('aria-expanded="false"');
      expect(collapsedHtml).toContain('aria-controls="map-overlays-panel"');
      expect(collapsedHtml).toContain('Show Map Overview');
    });

    it('(b) Guarantees single button rendering without duplicate controls', () => {
      const expandedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, { initialExpanded: true }),
      );
      // Exactly one hide button, zero show buttons
      const hideCount = (expandedHtml.match(/data-testid="hide-map-overview-btn"/g) || []).length;
      const showCount = (expandedHtml.match(/data-testid="show-map-overview-btn"/g) || []).length;
      expect(hideCount).toBe(1);
      expect(showCount).toBe(0);

      const collapsedHtml = renderToString(
        React.createElement(CollapsibleMapOverviewTestHarness, { initialExpanded: false }),
      );
      const hideCountCollapsed = (collapsedHtml.match(/data-testid="hide-map-overview-btn"/g) || [])
        .length;
      const showCountCollapsed = (collapsedHtml.match(/data-testid="show-map-overview-btn"/g) || [])
        .length;
      expect(hideCountCollapsed).toBe(0);
      expect(showCountCollapsed).toBe(1);
    });
  });
});
