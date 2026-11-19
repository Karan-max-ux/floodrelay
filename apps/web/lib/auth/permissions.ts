import type { OperatorProfile } from '../api/types';

export type OperationalAction =
  | 'VIEW_EVENTS'
  | 'VIEW_AUDIT'
  | 'VIEW_FORECAST'
  | 'MANAGE_RESOURCE_STATUS'
  | 'MANAGE_BLOCKED_ZONES'
  | 'REQUEST_REPAIR'
  | 'COMMIT_ASSIGNMENT'
  | 'CANCEL_REQUEST'
  | 'MANAGE_OPERATORS';

export const ROLE_PERMISSIONS: Record<
  'OPERATOR' | 'ADMIN' | 'DISPATCHER',
  ReadonlySet<OperationalAction>
> = {
  OPERATOR: new Set(['VIEW_EVENTS', 'VIEW_AUDIT', 'VIEW_FORECAST']),
  DISPATCHER: new Set([
    'VIEW_EVENTS',
    'VIEW_AUDIT',
    'VIEW_FORECAST',
    'MANAGE_RESOURCE_STATUS',
    'MANAGE_BLOCKED_ZONES',
    'REQUEST_REPAIR',
    'COMMIT_ASSIGNMENT',
    'CANCEL_REQUEST',
  ]),
  ADMIN: new Set([
    'VIEW_EVENTS',
    'VIEW_AUDIT',
    'VIEW_FORECAST',
    'MANAGE_RESOURCE_STATUS',
    'MANAGE_BLOCKED_ZONES',
    'REQUEST_REPAIR',
    'COMMIT_ASSIGNMENT',
    'CANCEL_REQUEST',
    'MANAGE_OPERATORS',
  ]),
};

export function hasPermission(
  operator: OperatorProfile | null | undefined,
  action: OperationalAction,
): boolean {
  if (!operator?.role) return false;
  return ROLE_PERMISSIONS[operator.role]?.has(action) ?? false;
}
