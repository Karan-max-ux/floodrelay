import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  REGION_CONFIG,
  formatRegionDate,
  formatRegionDateTime,
  formatRegionTime,
} from '../lib/region';
import { CitizenHeader } from '../components/citizen/CitizenHeader';
import { EmergencyBanner } from '../components/citizen/EmergencyBanner';
import { CitizenFooter } from '../components/citizen/CitizenFooter';
import { OperatorSidebar } from '../components/operator/OperatorSidebar';
import { OperatorMobileNav } from '../components/operator/OperatorMobileNav';
import CitizenHomePage from '../app/citizen/page';
import {
  CitizenReceiptCard,
  type CitizenReceiptCardProps,
} from '../components/citizen/CitizenReceiptCard';
import type { AssignmentRecord } from '../lib/api/types';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/citizen',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock OperatorAuthContext
vi.mock('@/lib/auth/OperatorAuthContext', () => ({
  useOperatorAuth: () => ({
    operator: {
      id: 'op-123',
      name: 'Rohan Sharma',
      username: 'delhi_eoc_operator',
      role: 'ADMIN',
    },
    logout: vi.fn(),
  }),
}));

describe('Delhi regional presentation and safety messaging', () => {
  const timestamp = '2026-11-15T06:00:00.000Z';

  it("sets Indian English, IST, and India's verified national emergency number", () => {
    expect(REGION_CONFIG.code).toBe('IN-DL');
    expect(REGION_CONFIG.label).toBe('Delhi NCR');
    expect(REGION_CONFIG.floodplain).toBe('Delhi–Yamuna Floodplain');
    expect(REGION_CONFIG.operatorTitle).toBe('Delhi Flood Operations Dashboard');
    expect(REGION_CONFIG.locale).toBe('en-IN');
    expect(REGION_CONFIG.timeZone).toBe('Asia/Kolkata');
    expect(REGION_CONFIG.emergencyNumber).toBe('112');
    expect(REGION_CONFIG.defaultMapCentre).toEqual({ lat: 28.6139, lng: 77.209 });
  });

  it('displays a fixed UTC timestamp in Indian Standard Time', () => {
    expect(formatRegionDate(timestamp)).toBe('15 Nov 2026');
    expect(formatRegionTime(timestamp)).toContain('11:30');
    expect(formatRegionTime(timestamp)).toContain('IST');
    expect(formatRegionDateTime(timestamp)).toContain('15 Nov 2026');
    expect(formatRegionDateTime(timestamp)).toContain('11:30');
    expect(formatRegionDateTime(timestamp)).toContain('IST');
  });

  it('does not expose invalid date output to citizens or operators', () => {
    expect(formatRegionDate('not-a-date')).toBe('Unknown');
    expect(formatRegionTime('not-a-date')).toBe('Unknown');
    expect(formatRegionDateTime('not-a-date')).toBe('Unknown');
  });

  it('Citizen portal components display 112 and no 911/311 emergency callouts', () => {
    const bannerHtml = renderToString(React.createElement(EmergencyBanner));
    expect(bannerHtml).toContain('112');
    expect(bannerHtml).toContain('href="tel:112"');
    expect(bannerHtml).not.toContain('911');
    expect(bannerHtml).not.toContain('311');

    const headerHtml = renderToString(React.createElement(CitizenHeader));
    expect(headerHtml).toContain('Delhi Flood Response • Prototype');
    expect(headerHtml).toContain('Call 112');
    expect(headerHtml).toContain('href="tel:112"');
    expect(headerHtml).not.toContain('911');
    expect(headerHtml).not.toContain('311');

    const footerHtml = renderToString(React.createElement(CitizenFooter));
    expect(footerHtml).toContain('href="tel:112"');
    expect(footerHtml).toContain('Emergency 112');
    expect(footerHtml).not.toContain('911');
    expect(footerHtml).not.toContain('311');
  });

  it('Operator navigation components display Delhi regional indicators and IST', () => {
    const sidebarHtml = renderToString(React.createElement(OperatorSidebar));
    expect(sidebarHtml).toContain('ONLINE - DELHI NCR');
    expect(sidebarHtml).toContain('IST');
    expect(sidebarHtml).not.toContain('SECTOR 4');
    expect(sidebarHtml).not.toContain('Capt. R. Vance');
    expect(sidebarHtml).toContain('Rohan Sharma');

    const mobileHtml = renderToString(
      React.createElement(OperatorMobileNav, { isOpen: true, onClose: vi.fn() }),
    );
    expect(mobileHtml).toContain('Delhi Operations Centre');
    expect(mobileHtml).not.toContain('Harris County');
  });

  it('Citizen confirmation displays FLOODRELAY REQUEST RECEIPT and avoids official claims', () => {
    const receiptHtml = renderToString(
      React.createElement<CitizenReceiptCardProps>(CitizenReceiptCard, {
        initialReceipt: {
          id: 'REQ-DELHI-2026-001',
          createdAt: '2026-11-15T06:00:00.000Z',
          urgency: 'HIGH',
          peopleCount: 3,
          isFlaggedDuplicate: false,
          duplicateOfId: null,
          idempotent: false,
          addressSummary: 'Yamuna Bazar, Kashmere Gate',
          approxLat: 28.66,
          approxLng: 77.23,
          waterLevel: 'Reached ground floor interior (1 - 3 feet)',
          hasSpecialNeeds: true,
          hasFieldNotes: true,
        },
      }),
    );

    expect(receiptHtml).toContain('FLOODRELAY REQUEST RECEIPT');
    expect(receiptHtml).not.toContain('OFFICIAL RECEIPT');
    expect(receiptHtml).toContain('REQ-DELHI-2026-001');
    expect(receiptHtml).toContain('href="tel:112"');
    expect(receiptHtml).not.toContain('911');
    expect(receiptHtml).not.toContain('311');
  });

  it('Citizen landing page displays operator-assisted review and no direct dispatch coordination', () => {
    const homeHtml = renderToString(React.createElement(CitizenHomePage));
    expect(homeHtml).toContain('Operator-assisted request review');
    expect(homeHtml).not.toContain('Direct dispatch coordination');
    expect(homeHtml).toContain('Check official flood advisories');
  });

  it('Three-step workflow does not guarantee physical rescue deployment', () => {
    const homeHtml = renderToString(React.createElement(CitizenHomePage));
    expect(homeHtml).toContain('Three Steps from Request to Response Planning');
    expect(homeHtml).not.toContain('Three Steps from Intake to Safe Extraction');
    expect(homeHtml).not.toContain('How Dispatch Operates');
    expect(homeHtml).toContain(
      'If an authorised rescue team accepts the request, it may use the recorded location to plan a response. Submission does not guarantee deployment.',
    );
    expect(homeHtml).not.toContain(
      'Rescue crews receive your location ticket and navigate via accessible corridors',
    );
    expect(homeHtml).not.toContain('so suitable rescue craft can be dispatched');
  });

  it('preserves ISO 8601 UTC timestamp serialization for API payloads', () => {
    const originalIso = '2026-11-15T06:00:00.000Z';
    const parsedDate = new Date(originalIso);
    expect(parsedDate.toISOString()).toBe(originalIso);
  });

  it('preserves REAL versus SIMULATED provenance classifications on assignment records', () => {
    const realPlan: AssignmentRecord = {
      id: 'plan_real_001',
      scenarioId: 'delhi-yamuna-real',
      status: 'PROPOSED',
      provenance: 'REAL',
      metrics: {
        coveragePercent: 100,
        totalTravelTimeMinutes: 45,
        totalTravelDistanceKm: 12,
        highPriorityWaitTimeMinutes: 10,
        solveDurationMs: 25,
        servedRequestsCount: 4,
        unservedRequestsCount: 0,
      },
      unserved: [],
      routes: [],
      stops: [],
      createdAt: '2026-11-15T06:00:00.000Z',
      updatedAt: '2026-11-15T06:00:00.000Z',
    };

    const simPlan: AssignmentRecord = {
      ...realPlan,
      id: 'plan_sim_002',
      provenance: 'SIMULATED',
    };

    expect(realPlan.provenance).toBe('REAL');
    expect(simPlan.provenance).toBe('SIMULATED');
    expect(realPlan.provenance).not.toBe(simPlan.provenance);
  });
});
