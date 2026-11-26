import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OperatorTopNav,
  OPERATOR_NAV_ITEMS,
  isItemActive,
} from '../components/operator/OperatorTopNav';
import OperatorLayout from '../app/operator/layout';

// Mock next/navigation
let mockPathname = '/operator';
const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mockRouterReplace,
    push: mockRouterPush,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock OperatorAuthContext
let mockAuthState = {
  isAuthenticated: true,
  isLoading: false,
  operator: {
    id: 'op-001',
    name: 'Capt. R. Vance',
    username: 'eoc_operator',
    role: 'ADMIN',
  },
  logout: vi.fn(),
};

vi.mock('@/lib/auth/OperatorAuthContext', () => ({
  OperatorAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useOperatorAuth: () => mockAuthState,
}));

describe('Phase 1 & 2: Operator Top Navigation & Full-Width Workspace Layout', () => {
  beforeEach(() => {
    mockPathname = '/operator';
    mockRouterReplace.mockClear();
    mockRouterPush.mockClear();
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
      operator: {
        id: 'op-001',
        name: 'Capt. R. Vance',
        username: 'eoc_operator',
        role: 'ADMIN',
      },
      logout: vi.fn(),
    };
  });

  describe('1. Route Configuration & Item Invariants', () => {
    it('defines exactly the 7 required operational command routes', () => {
      const routes = OPERATOR_NAV_ITEMS.map((item) => ({
        label: item.label,
        href: item.href,
      }));

      expect(routes).toEqual([
        { label: 'Overview', href: '/operator' },
        { label: 'Fleet', href: '/operator/fleet' },
        { label: 'Requests', href: '/operator/requests' },
        { label: 'Live Map', href: '/operator/map' },
        { label: 'Assignments', href: '/operator/assignments' },
        { label: 'Events', href: '/operator/events' },
        { label: 'Audit', href: '/operator/audit' },
      ]);
    });
  });

  describe('2. Active Route Highlighting (isItemActive)', () => {
    it('highlights Overview only on exact /operator path', () => {
      expect(isItemActive('/operator', '/operator', true)).toBe(true);
      expect(isItemActive('/operator/fleet', '/operator', true)).toBe(false);
      expect(isItemActive('/operator/requests', '/operator', true)).toBe(false);
      expect(isItemActive('/operator/map', '/operator', true)).toBe(false);
      expect(isItemActive('/operator/assignments', '/operator', true)).toBe(false);
    });

    it('highlights Fleet on /operator/fleet and sub-paths', () => {
      expect(isItemActive('/operator/fleet', '/operator/fleet', false)).toBe(true);
      expect(isItemActive('/operator/fleet/res-1', '/operator/fleet', false)).toBe(true);
      expect(isItemActive('/operator', '/operator/fleet', false)).toBe(false);
    });

    it('highlights Requests on /operator/requests and sub-paths', () => {
      expect(isItemActive('/operator/requests', '/operator/requests', false)).toBe(true);
      expect(isItemActive('/operator/requests/req_001', '/operator/requests', false)).toBe(true);
      expect(isItemActive('/operator/assignments', '/operator/requests', false)).toBe(false);
    });

    it('highlights Live Map on /operator/map', () => {
      expect(isItemActive('/operator/map', '/operator/map', false)).toBe(true);
      expect(isItemActive('/operator', '/operator/map', false)).toBe(false);
    });

    it('highlights Assignments on root /operator/assignments', () => {
      expect(isItemActive('/operator/assignments', '/operator/assignments', false)).toBe(true);
    });

    it('preserves Assignments highlighting on nested proposal inspection routes /operator/assignments/[id]', () => {
      expect(
        isItemActive(
          '/operator/assignments/assign_1793478900_abcde',
          '/operator/assignments',
          false,
        ),
      ).toBe(true);
      expect(
        isItemActive('/operator/assignments/PR-105-PLAN', '/operator/assignments', false),
      ).toBe(true);
    });

    it('highlights Events and Audit on their respective routes', () => {
      expect(isItemActive('/operator/events', '/operator/events', false)).toBe(true);
      expect(isItemActive('/operator/audit', '/operator/audit', false)).toBe(true);
    });
  });

  describe('3. Desktop TopNav Rendering', () => {
    it('renders horizontal brand, nav links, operator identity, and sign out control', () => {
      mockPathname = '/operator/requests';
      const html = renderToString(<OperatorTopNav />);

      expect(html).toContain('FloodRelay Command');
      expect(html).toContain('OPERATOR PORTAL');

      // All 6 routes rendered in markup
      expect(html).toContain('href="/operator"');
      expect(html).toContain('href="/operator/requests"');
      expect(html).toContain('href="/operator/map"');
      expect(html).toContain('href="/operator/assignments"');
      expect(html).toContain('href="/operator/events"');
      expect(html).toContain('href="/operator/audit"');
      expect(html).toContain('href="/limitations"');

      // Operator identity
      expect(html).toContain('Capt. R. Vance');
      expect(html).toContain('(ADMIN)');
      expect(html).toContain('Sign Out');

      // Does not contain obsolete fabricated online beacon
      expect(html).not.toContain('ONLINE - SECTOR 4');
    });

    it('sets aria-current="page" on the active navigation item', () => {
      mockPathname = '/operator/assignments';
      const html = renderToString(<OperatorTopNav />);

      // Assignments should have aria-current="page"
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('href="/operator/assignments"');
    });
  });

  describe('4. Mobile Navigation Accessibility Invariants', () => {
    it('includes accessible mobile toggle button with aria attributes', () => {
      const html = renderToString(<OperatorTopNav />);
      expect(html).toContain('aria-label="Open navigation menu"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-controls="operator-mobile-drawer"');
    });
  });

  describe('5. Layout Full-Width Canvas & Absence of Sidebar Offset', () => {
    it('renders layout without lg:ml-64 sidebar offset', () => {
      const html = renderToString(
        <OperatorLayout>
          <div data-testid="test-content">Dashboard Content</div>
        </OperatorLayout>,
      );

      expect(html).not.toContain('lg:ml-64');
      expect(html).toContain('data-testid="test-content"');
      expect(html).toContain('Dashboard Content');
      expect(html).toContain('FloodRelay Command');
    });

    it('displays loading state during session verification', () => {
      mockAuthState = {
        isAuthenticated: false,
        isLoading: true,
        operator: null as unknown as typeof mockAuthState.operator,
        logout: vi.fn(),
      };

      const html = renderToString(
        <OperatorLayout>
          <div>Protected Content</div>
        </OperatorLayout>,
      );

      expect(html).toContain('VERIFYING COMMAND SESSION...');
      expect(html).not.toContain('Protected Content');
    });

    it('displays authentication required redirect screen when unauthenticated without triggering router in render', () => {
      mockAuthState = {
        isAuthenticated: false,
        isLoading: false,
        operator: null as unknown as typeof mockAuthState.operator,
        logout: vi.fn(),
      };

      const html = renderToString(
        <OperatorLayout>
          <div>Protected Content</div>
        </OperatorLayout>,
      );

      expect(html).toContain('AUTHENTICATION REQUIRED');
      expect(html).toContain('Redirecting to secure operator login...');
      expect(html).not.toContain('Protected Content');
      // Must not call router.replace during component render phase
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });
  });
});
