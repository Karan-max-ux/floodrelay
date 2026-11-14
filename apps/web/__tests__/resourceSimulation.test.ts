import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ResourceStatusPanel } from '../components/operator/ResourceStatusPanel';
import { SIMULATED_RESOURCES } from '../lib/fixtures/resources';
import type { RescueResource } from '@floodrelay/shared';

// Mock OperatorAuthContext
vi.mock('@/lib/auth/OperatorAuthContext', () => ({
  useOperatorAuth: () => ({
    operator: {
      id: 'op-dispatcher-1',
      username: 'lead_dispatcher',
      role: 'DISPATCHER',
    },
    token: 'test-token',
    isAuthenticated: true,
  }),
}));

describe('Authoritative Resource Roster & Simulation Safeguards', () => {
  it('renders the authoritative roster header and healthy live states', () => {
    const html = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: SIMULATED_RESOURCES,
      }),
    );

    expect(html).toContain('[AUTHORITATIVE ROSTER]');
    expect(html).toContain('Rescue Fleet &amp; Resource Roster');
    // Ensure the old pending banner is gone
    expect(html).not.toContain(
      'Authoritative Resource Read Endpoint Pending (GET /operations/resources)',
    );
  });

  it('marks simulated assets with SIMULATED tag and disables status updates', () => {
    const html = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: SIMULATED_RESOURCES,
      }),
    );

    // Simulated resources must have SIMULATED tag
    expect(html).toContain('SIMULATED');
    // Simulated resources must have Read-only (Simulated) label instead of update button
    expect(html).toContain('Read-only (Simulated)');
  });

  it('allows Update button only for authentic non-simulated database resources', () => {
    const realResource: RescueResource = {
      id: 'boat_real_unit_1', // Note ID begins with boat_ but source is REAL
      name: 'Engine 42 High-Water Unit',
      type: 'HIGH_WATER_VEHICLE',
      capacity: 10,
      speedKmH: 35,
      lat: 29.76,
      lng: -95.36,
      status: 'AVAILABLE',
      source: 'REAL',
    };

    const mixedResources = [realResource, ...SIMULATED_RESOURCES];

    const html = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: mixedResources,
      }),
    );

    // The authentic resource should have REAL badge and Update button despite boat_ prefix
    expect(html).toContain('REAL');
    expect(html).toContain('Update');
    // The simulated resources still have Read-only (Simulated)
    expect(html).toContain('Read-only (Simulated)');
  });

  it('renders connection error state and stale cache notice properly', () => {
    const errorHtml = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: [],
        error: 'Failed to connect to backend',
      }),
    );

    expect(errorHtml).toContain('Resource Inventory Connection Error');
    expect(errorHtml).toContain('Failed to connect to backend');

    const staleHtml = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: SIMULATED_RESOURCES,
        isStale: true,
      }),
    );

    expect(staleHtml).toContain(
      'Displaying cached resource roster. Reconnecting to live inventory...',
    );
  });

  it('renders loading and empty states when no resources are loaded', () => {
    const loadingHtml = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: [],
        isLoading: true,
      }),
    );

    expect(loadingHtml).toContain('Loading authoritative rescue fleet roster...');

    const emptyHtml = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: [],
        isLoading: false,
      }),
    );

    expect(emptyHtml).toContain('No rescue resources registered in database.');
  });

  it('provides a direct DB UUID override form for dispatchers', () => {
    const html = renderToString(
      React.createElement(ResourceStatusPanel, {
        resources: SIMULATED_RESOURCES,
      }),
    );

    expect(html).toContain('Direct DB ID Override');
  });
});
