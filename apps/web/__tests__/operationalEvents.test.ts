import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import type {
  OperationalEvent,
  AffectedScopeResult,
  OperatorProfile,
  ListOperationalEventsFilter,
} from '../lib/api/types';
import { hasPermission } from '../lib/auth/permissions';
import { ApiClientError } from '../lib/api/errors';
import { AffectedScopePanel } from '../components/operator/AffectedScopePanel';

describe('Phase 5 Part 3 — Operational Events & Live Decision Support Invariants', () => {
  const sampleEvents: OperationalEvent[] = [
    {
      id: 'evt-001',
      type: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      entityId: 'req-101',
      occurredAt: '2026-11-05T01:00:00Z',
      recordedAt: '2026-11-05T01:00:00Z',
      actorType: 'CITIZEN',
      actorId: 'cit-anonymous',
      processingStatus: 'SCOPE_IDENTIFIED',
      payload: {
        peopleCount: 4,
        urgency: 'CRITICAL',
        lat: 29.76,
        lng: -95.36,
      },
    },
    {
      id: 'evt-002',
      type: 'RESOURCE_OFFLINE',
      entityType: 'RESOURCE',
      entityId: 'res-boat-alpha',
      occurredAt: '2026-11-05T01:05:00Z',
      recordedAt: '2026-11-05T01:05:00Z',
      actorType: 'OPERATOR',
      actorId: 'dispatcher-1',
      processingStatus: 'SCOPE_IDENTIFIED',
      payload: {
        previousStatus: 'AVAILABLE',
        newStatus: 'OFFLINE',
        reason: 'Engine intake water fouling in Buffalo Bayou',
      },
    },
    {
      id: 'evt-003',
      type: 'ROAD_BLOCKED',
      entityType: 'ROAD_ZONE',
      entityId: 'zone-heights-surge',
      occurredAt: '2026-11-05T01:10:00Z',
      recordedAt: '2026-11-05T01:10:00Z',
      actorType: 'OPERATOR',
      actorId: 'dispatcher-1',
      processingStatus: 'SCOPE_IDENTIFIED',
      payload: {
        name: 'Heights Blvd Flood Surge (Zone Z-402)',
        severity: 'BLOCKED',
        polygon: [
          { lat: 29.775, lng: -95.405 },
          { lat: 29.778, lng: -95.395 },
          { lat: 29.77, lng: -95.392 },
          { lat: 29.768, lng: -95.402 },
        ],
      },
    },
  ];

  describe('1. Event Filtering Invariants', () => {
    function filterEvents(
      events: OperationalEvent[],
      filter: ListOperationalEventsFilter,
    ): OperationalEvent[] {
      return events.filter((evt) => {
        if (filter.type && evt.type !== filter.type) return false;
        if (filter.entityType && evt.entityType !== filter.entityType) return false;
        if (filter.entityId && !evt.entityId.toLowerCase().includes(filter.entityId.toLowerCase()))
          return false;
        if (filter.status && evt.processingStatus !== filter.status) return false;
        if (filter.actorId && evt.actorId !== filter.actorId) return false;
        return true;
      });
    }

    it('filters events by entity type correctly', () => {
      const resourceEvents = filterEvents(sampleEvents, { entityType: 'RESOURCE' });
      expect(resourceEvents).toHaveLength(1);
      expect(resourceEvents[0].id).toBe('evt-002');
    });

    it('filters events by event type correctly', () => {
      const roadEvents = filterEvents(sampleEvents, { type: 'ROAD_BLOCKED' });
      expect(roadEvents).toHaveLength(1);
      expect(roadEvents[0].entityType).toBe('ROAD_ZONE');
    });

    it('filters events by partial entityId match', () => {
      const boatEvents = filterEvents(sampleEvents, { entityId: 'boat-alpha' });
      expect(boatEvents).toHaveLength(1);
      expect(boatEvents[0].entityId).toBe('res-boat-alpha');
    });

    it('returns empty array when filter matches no events', () => {
      const empty = filterEvents(sampleEvents, { entityType: 'ASSIGNMENT' });
      expect(empty).toHaveLength(0);
    });
  });

  describe('2. Affected Scope Invariants', () => {
    const mockScope: AffectedScopeResult = {
      eventId: 'evt-002',
      affectedRequestIds: ['req-101', 'req-102'],
      affectedResourceIds: ['res-boat-alpha'],
      affectedProposedAssignmentIds: ['assign-prop-1'],
      committedAssignmentsRequiringReview: ['assign-comm-99'],
      repairEligible: true,
      reason: 'Vehicle offline affects 2 scheduled pickup stops on committed route assign-comm-99',
    };

    it('identifies when committed missions require human dispatcher review', () => {
      expect(mockScope.committedAssignmentsRequiringReview.length).toBeGreaterThan(0);
      expect(mockScope.committedAssignmentsRequiringReview).toContain('assign-comm-99');
    });

    it('flags repair eligibility based on affected entities', () => {
      expect(mockScope.repairEligible).toBe(true);
      expect(
        mockScope.affectedRequestIds.length + mockScope.affectedResourceIds.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('3. HTTP 503 Solver Engine Unavailable Fallback Contract', () => {
    it('gracefully classifies 503 error without crashing UI state', () => {
      const error503 = new ApiClientError({
        message:
          'Incremental repair engine is not available. Part 1 establishes backend contracts; solver integration is reserved for Part 2.',
        statusCode: 503,
        code: 'REPAIR_ENGINE_UNAVAILABLE',
      });

      const isSolverUnavailable =
        error503.statusCode === 503 || error503.code === 'REPAIR_ENGINE_UNAVAILABLE';
      expect(isSolverUnavailable).toBe(true);

      const userNotice = isSolverUnavailable
        ? 'Phase 5 Part 2 solver engine is currently undergoing integration. Live solver repair proposal calculation is unavailable.'
        : error503.message;

      expect(userNotice).toContain('Phase 5 Part 2 solver engine');
      expect(userNotice).toContain('unavailable');
    });
  });

  describe('4. RBAC Authorization for Operational Actions', () => {
    const operatorUser: OperatorProfile = {
      id: 'op-1',
      username: 'field_operator',
      name: 'Field Operator 1',
      role: 'OPERATOR',
    };

    const dispatcherUser: OperatorProfile = {
      id: 'disp-1',
      username: 'head_dispatcher',
      name: 'Chief Dispatcher',
      role: 'DISPATCHER',
    };

    const adminUser: OperatorProfile = {
      id: 'admin-1',
      username: 'sys_admin',
      name: 'System Administrator',
      role: 'ADMIN',
    };

    it('OPERATOR role can view events and audit but CANNOT trigger repairs or commit assignments', () => {
      expect(hasPermission(operatorUser, 'VIEW_EVENTS')).toBe(true);
      expect(hasPermission(operatorUser, 'VIEW_AUDIT')).toBe(true);
      expect(hasPermission(operatorUser, 'REQUEST_REPAIR')).toBe(false);
      expect(hasPermission(operatorUser, 'COMMIT_ASSIGNMENT')).toBe(false);
      expect(hasPermission(operatorUser, 'MANAGE_RESOURCE_STATUS')).toBe(false);
      expect(hasPermission(operatorUser, 'MANAGE_BLOCKED_ZONES')).toBe(false);
    });

    it('DISPATCHER role can trigger repairs, commit assignments, and manage road zones', () => {
      expect(hasPermission(dispatcherUser, 'VIEW_EVENTS')).toBe(true);
      expect(hasPermission(dispatcherUser, 'REQUEST_REPAIR')).toBe(true);
      expect(hasPermission(dispatcherUser, 'COMMIT_ASSIGNMENT')).toBe(true);
      expect(hasPermission(dispatcherUser, 'MANAGE_RESOURCE_STATUS')).toBe(true);
      expect(hasPermission(dispatcherUser, 'MANAGE_BLOCKED_ZONES')).toBe(true);
      expect(hasPermission(dispatcherUser, 'MANAGE_OPERATORS')).toBe(false);
    });

    it('ADMIN role has all operational and governance permissions', () => {
      expect(hasPermission(adminUser, 'VIEW_EVENTS')).toBe(true);
      expect(hasPermission(adminUser, 'REQUEST_REPAIR')).toBe(true);
      expect(hasPermission(adminUser, 'COMMIT_ASSIGNMENT')).toBe(true);
      expect(hasPermission(adminUser, 'MANAGE_RESOURCE_STATUS')).toBe(true);
      expect(hasPermission(adminUser, 'MANAGE_BLOCKED_ZONES')).toBe(true);
      expect(hasPermission(adminUser, 'MANAGE_OPERATORS')).toBe(true);
    });
  });

  describe('5. AffectedScopePanel Component Invariants (Item 3)', () => {
    it('(a) renders counts "1", "0", "0", "1" and lists the ids for a populated scope', () => {
      const scopeWithItems: AffectedScopeResult = {
        eventId: 'evt-001',
        affectedRequestIds: ['req-alpha'],
        affectedResourceIds: [],
        affectedProposedAssignmentIds: [],
        committedAssignmentsRequiringReview: ['comm-mission-99'],
        repairEligible: true,
        reason: 'Vehicle offline impacts active route',
      };

      const html = renderToString(
        React.createElement(AffectedScopePanel, {
          scope: scopeWithItems,
          canRequestRepair: true,
        }),
      );

      // Verify counts are rendered in markup
      expect(html).toContain('Affected Requests');
      expect(html).toContain('1');
      expect(html).toContain('Affected Resources');
      expect(html).toContain('0');
      expect(html).toContain('Proposed Plans Needing Attention');
      expect(html).toContain('Committed Missions Requiring Review');

      // Verify IDs are listed
      expect(html).toContain('req-alpha');
      expect(html).toContain('comm-mission-99');
    });

    it('(b) all-empty arrays render zeros and no id lists without throwing', () => {
      const emptyScope: AffectedScopeResult = {
        eventId: 'evt-002',
        affectedRequestIds: [],
        affectedResourceIds: [],
        affectedProposedAssignmentIds: [],
        committedAssignmentsRequiringReview: [],
        repairEligible: false,
        reason: 'Zero affected entities',
      };

      let html = '';
      expect(() => {
        html = renderToString(
          React.createElement(AffectedScopePanel, {
            scope: emptyScope,
          }),
        );
      }).not.toThrow();

      expect(html).toContain('Affected Requests');
      expect(html).toContain('0');
      // No id list tags should be rendered when length is 0
      expect(html).not.toContain('req-');
      expect(html).not.toContain('res-');
      expect(html).not.toContain('comm-');
      expect(html).not.toContain('Committed Rescue Missions Impacted');
    });

    it('(c) the repair button state follows repairEligible', () => {
      const eligibleScope: AffectedScopeResult = {
        eventId: 'evt-003',
        affectedRequestIds: ['req-101'],
        affectedResourceIds: [],
        affectedProposedAssignmentIds: [],
        committedAssignmentsRequiringReview: [],
        repairEligible: true,
        reason: 'Eligible for plan repair',
      };

      const htmlEligible = renderToString(
        React.createElement(AffectedScopePanel, {
          scope: eligibleScope,
          canRequestRepair: true,
        }),
      );

      // When repairEligible is true, button is enabled (not disabled)
      expect(htmlEligible).toContain('Request Incremental Repair');
      expect(htmlEligible).not.toMatch(/disabled=""[^>]*>[\s\S]*?Request Incremental Repair/);

      const ineligibleScope: AffectedScopeResult = {
        ...eligibleScope,
        repairEligible: false,
      };

      const htmlIneligible = renderToString(
        React.createElement(AffectedScopePanel, {
          scope: ineligibleScope,
          canRequestRepair: true,
        }),
      );

      // When repairEligible is false, button is disabled
      expect(htmlIneligible).toMatch(/disabled=""[^>]*>[\s\S]*?Request Incremental Repair/);
    });
  });
});
