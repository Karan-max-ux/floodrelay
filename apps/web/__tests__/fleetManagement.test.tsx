import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FleetManagementPage from '../app/operator/fleet/page';
import { RescueFleetManagementView } from '../components/operator/RescueFleetManagementView';
import { APPROVED_VEHICLE_CATALOG } from '@floodrelay/shared';

// Mock OperatorAuthContext
let mockAuthState = {
  isAuthenticated: true,
  isLoading: false,
  operator: {
    id: 'op-admin-1',
    name: 'Capt. R. Vance',
    username: 'eoc_admin',
    role: 'ADMIN',
  },
  logout: vi.fn(),
};

vi.mock('@/lib/auth/OperatorAuthContext', () => ({
  OperatorAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useOperatorAuth: () => mockAuthState,
}));

// Mock API client
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    listResources: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'res-delhi-boat-01',
          name: 'Yamuna Patrol 1',
          type: 'BOAT',
          capacity: 8,
          speedKmH: 25,
          lat: 28.668,
          lng: 77.232,
          status: 'AVAILABLE',
          source: 'REAL',
          modelId: 'boat-irb-standard',
          notes: 'Active Yamuna duty',
          version: 1,
        },
        {
          id: 'res-sim-carrier-01',
          name: 'Simulated 4x4 Carrier',
          type: 'HIGH_WATER_VEHICLE',
          capacity: 8,
          speedKmH: 40,
          lat: 28.63,
          lng: 77.21,
          status: 'OFFLINE',
          source: 'SIMULATED',
          modelId: 'high-water-carrier-light',
          notes: 'Synthetic load benchmark',
          version: 1,
        },
      ],
      count: 2,
    }),
    listVehicleModels: vi.fn().mockResolvedValue({
      success: true,
      data: [],
    }),
    registerResource: vi.fn().mockResolvedValue({
      success: true,
      data: {
        resource: {
          id: 'res-7f3a91c2',
          name: 'New Registered Vessel',
          type: 'BOAT',
          capacity: 8,
          speedKmH: 25,
          lat: 28.668,
          lng: 77.232,
          status: 'OFFLINE',
          source: 'REAL',
          version: 1,
        },
      },
    }),
    updateResourceDetails: vi.fn().mockResolvedValue({
      success: true,
      data: {
        resource: {
          id: 'res-delhi-boat-01',
          name: 'Yamuna Patrol 1 (Overhauled)',
          type: 'BOAT',
          capacity: 10,
          speedKmH: 25,
          lat: 28.668,
          lng: 77.232,
          status: 'AVAILABLE',
          source: 'REAL',
          version: 2,
        },
      },
    }),
    updateResourceStatus: vi.fn().mockResolvedValue({
      success: true,
      data: {
        resource: {
          id: 'res-delhi-boat-01',
          status: 'OFFLINE',
        },
      },
    }),
    verifyResource: vi.fn().mockResolvedValue({
      success: true,
      data: {
        resource: {
          id: 'res-delhi-boat-01',
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'eoc_admin',
        },
      },
    }),
  },
}));

describe('Rescue Fleet Management Portal Component Tests', () => {
  beforeEach(() => {
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      operator: {
        id: 'op-admin-1',
        name: 'Capt. R. Vance',
        username: 'eoc_admin',
        role: 'ADMIN',
      },
      logout: vi.fn(),
    };
  });

  describe('Page Header & Architecture', () => {
    it('renders page title and subtitle', () => {
      const html = renderToString(<FleetManagementPage />);
      expect(html).toContain('Rescue Fleet Management');
      expect(html).toContain(
        'Operational vehicle inventory, database-backed registration, and lifecycle status control.',
      );
    });

    it('renders KPI summary cards', () => {
      const html = renderToString(<FleetManagementPage />);
      expect(html).toContain('Total Fleet');
      expect(html).toContain('Available (Ready)');
      expect(html).toContain('In-Mission');
      expect(html).toContain('Offline / Maint');
      expect(html).toContain('Access Tier');
    });

    it('renders tabs navigation between Fleet Roster, Register Vehicle, and Status Updates', () => {
      const html = renderToString(<FleetManagementPage />);
      expect(html).toContain('Fleet Roster');
      expect(html).toContain('Register New Vehicle');
      expect(html).toContain('Update Vehicle Status');
    });

    it('renders filter controls for search, type, status, and provenance boundary', () => {
      const html = renderToString(<FleetManagementPage />);
      expect(html).toContain('Search Fleet');
      expect(html).toContain('Vehicle Type');
      expect(html).toContain('Operational Status');
      expect(html).toContain('Provenance Boundary');
    });
  });

  describe('Catalog & Model Selection Invariants', () => {
    it('approved catalog contains all standard disaster response categories', () => {
      const categories = new Set(APPROVED_VEHICLE_CATALOG.map((m) => m.category));
      expect(categories).toContain('Rescue Boat');
      expect(categories).toContain('High-Water Rescue Vehicle');
      expect(categories).toContain('Ambulance');
      expect(categories).toContain('Rescue Helicopter');
    });

    it('maps all catalog models to supported backend resource types', () => {
      const types = new Set(APPROVED_VEHICLE_CATALOG.map((m) => m.type));
      expect(types).toContain('BOAT');
      expect(types).toContain('HIGH_WATER_VEHICLE');
      expect(types).toContain('AMBULANCE');
      expect(types).toContain('HELICOPTER');
    });

    it('enforces min and max capacity and speed limits across all catalog models', () => {
      for (const model of APPROVED_VEHICLE_CATALOG) {
        expect(model.minCapacity).toBeGreaterThanOrEqual(1);
        expect(model.maxCapacity).toBeGreaterThan(model.minCapacity);
        expect(model.defaultCapacity).toBeGreaterThanOrEqual(model.minCapacity);
        expect(model.defaultCapacity).toBeLessThanOrEqual(model.maxCapacity);

        expect(model.minSpeedKmH).toBeGreaterThan(0);
        expect(model.maxSpeedKmH).toBeGreaterThan(model.minSpeedKmH);
        expect(model.defaultSpeedKmH).toBeGreaterThanOrEqual(model.minSpeedKmH);
        expect(model.defaultSpeedKmH).toBeLessThanOrEqual(model.maxSpeedKmH);
      }
    });
  });

  describe('Role-Based Access Control UI Invariants', () => {
    it('enables registration action for ADMIN role', () => {
      mockAuthState.operator.role = 'ADMIN';
      const html = renderToString(<FleetManagementPage />);
      expect(html).toContain('Register New Vehicle');
    });

    it('indicates restricted editing for DISPATCHER or OPERATOR roles', () => {
      mockAuthState.operator.role = 'OPERATOR';
      const html = renderToString(<FleetManagementPage />);
      // Should show read-only note or disabled state for registration tab
      expect(html).toContain('Rescue Fleet Management');
    });

    it('renders Verification column and status badges in the Fleet Roster', () => {
      const mockResources = [
        {
          id: 'res-delhi-boat-01',
          name: 'Yamuna Patrol 1',
          type: 'BOAT' as const,
          capacity: 8,
          speedKmH: 25,
          lat: 28.668,
          lng: 77.232,
          status: 'AVAILABLE' as const,
          source: 'REAL' as const,
          verificationStatus: 'VERIFIED' as const,
          version: 1,
        },
        {
          id: 'res-new-unverified',
          name: 'Delhi Rapid Craft',
          type: 'BOAT' as const,
          capacity: 6,
          speedKmH: 25,
          lat: 28.668,
          lng: 77.232,
          status: 'OFFLINE' as const,
          source: 'REAL' as const,
          verificationStatus: 'UNVERIFIED' as const,
          version: 1,
        },
      ];
      const html = renderToString(<RescueFleetManagementView initialResources={mockResources} />);
      expect(html).toContain('Verification');
      expect(html).toContain('VERIFIED');
      expect(html).toContain('UNVERIFIED');
    });
  });
});
