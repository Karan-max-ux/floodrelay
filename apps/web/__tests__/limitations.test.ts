import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import LimitationsPage from '../app/limitations/page';
import { CitizenFooter } from '../components/citizen/CitizenFooter';
import { OperatorSidebar } from '../components/operator/OperatorSidebar';
import { OperatorMobileNav } from '../components/operator/OperatorMobileNav';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/operator',
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
      name: 'Capt. R. Vance',
      username: 'eoc_operator',
      role: 'ADMIN',
    },
    logout: vi.fn(),
  }),
}));

describe('Phase 6 Feature 3: Operational Limitations & System Boundaries', () => {
  describe('/limitations Page Rendering & Content Structure', () => {
    it('renders the main heading and document subtitle', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Operational Limitations &amp; System Boundaries');
      expect(html).toContain('FloodRelay is a human-supervised decision-support platform');
      expect(html).toContain('FloodRelay System Boundaries &amp; Uncertainty Disclosure');
      expect(html).not.toContain('Official System Boundaries &amp; Uncertainty Disclosure');
    });

    it('contains Section 1: Purpose & Scope of Decision Support', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Purpose &amp; Scope of Decision Support');
      expect(html).toContain('operational decision-support system');
      expect(html).toContain('does not operate as an autonomous emergency (112) dispatch service');
      expect(html).not.toContain('911');
    });

    it('contains Section 2: GPS & Location Uncertainty', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('GPS &amp; Location Uncertainty');
      expect(html).toContain('Browser GPS Variance');
      expect(html).toContain('Reverse-Geocoding Approximation');
      expect(html).toContain('Landmark Reliance');
    });

    it('contains Section 3: Route & Travel-Time Uncertainty', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Route &amp; Travel-Time Uncertainty');
      expect(html).toContain('Static OpenStreetMap Data');
      expect(html).toContain('No Live Traffic Feed');
      expect(html).toContain('Resource-Type Specific Routing');
      expect(html).toContain('No Certified Route Safety');
    });

    it('contains Section 4: Simulated & Reference Data Boundaries', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Simulated &amp; Reference Data Boundaries');
      expect(html).toContain('SIMULATED');
      expect(html).toContain('Reference Fleet Specifications');
      expect(html).toContain('Provenance Auditing');
    });

    it('contains Section 5: Optimization Model Limitations & Shift Constraints', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Optimization Model Limitations &amp; Shift Constraints');
      expect(html).toContain('SHIFT_LIMIT_REACHED');
      expect(html).toContain('GROUP_LARGER_THAN_ANY_VEHICLE');
      expect(html).toContain('Frozen Stops &amp; Incremental Churn');
    });

    it('contains Section 6: Human-Supervised Operations', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Human-Supervised Operations (No Autonomous Commitment)');
      expect(html).toContain('No Autonomous Dispatch');
      expect(html).toContain('Authoritative Operator Authorization');
      expect(html).toContain('COMMITTED');
      expect(html).toContain('Immutable Audit Logging');
    });

    it('contains Section 7: Operational Availability & Technical Dependencies', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Operational Availability &amp; Technical Dependencies');
      expect(html).toContain('Network Degradation');
      expect(html).toContain('No Unconditional Uptime Warranty');
    });

    it('contains Section 8: Life-Threatening Emergency Guidance', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('Life-Threatening Emergency Notice');
      expect(html).toContain('Contact official local emergency services immediately');
      expect(html).toContain('112');
      expect(html).not.toContain('911');
    });

    it('provides quick jump anchor navigation for all key sections', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('href="#purpose-scope"');
      expect(html).toContain('href="#location-uncertainty"');
      expect(html).toContain('href="#routing-uncertainty"');
      expect(html).toContain('href="#simulated-data"');
      expect(html).toContain('href="#optimization-limits"');
      expect(html).toContain('href="#human-supervision"');
      expect(html).toContain('href="#operational-availability"');
      expect(html).toContain('href="#emergency-safety"');
    });

    it('renders the system invariant summary table', () => {
      const html = renderToString(React.createElement(LimitationsPage));
      expect(html).toContain('System Invariant Summary');
      expect(html).toContain('Dispatch Authority');
      expect(html).toContain('Committed Stops');
      expect(html).toContain('Citizen Intake');
      expect(html).toContain('Duplicate Reports');
      expect(html).toContain('Vehicle Shifts');
    });
  });

  describe('Portal Navigation Integration', () => {
    it('CitizenFooter links directly to /limitations', () => {
      const html = renderToString(React.createElement(CitizenFooter));
      expect(html).toContain('href="/limitations"');
      expect(html).toContain('Operational Limitations');
    });

    it('OperatorSidebar links directly to /limitations', () => {
      const html = renderToString(React.createElement(OperatorSidebar));
      expect(html).toContain('href="/limitations"');
      expect(html).toContain('Operational Limitations');
    });

    it('OperatorMobileNav links directly to /limitations when open', () => {
      const html = renderToString(
        React.createElement(OperatorMobileNav, { isOpen: true, onClose: vi.fn() }),
      );
      expect(html).toContain('href="/limitations"');
      expect(html).toContain('Operational Limitations');
    });
  });
});
