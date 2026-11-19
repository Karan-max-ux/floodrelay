import type { Request, Response, NextFunction } from 'express';
import type { OperatorRole } from '../db/schema.js';

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

export const ROLE_PERMISSIONS: Record<OperatorRole, ReadonlySet<OperationalAction>> = {
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

export function hasPermission(role: OperatorRole, action: OperationalAction): boolean {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

/**
 * Middleware requiring that the authenticated operator possesses the specified action permission.
 */
export function requirePermission(action: OperationalAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const operator = req.operator;
    if (!operator) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Operator authentication required to perform this action',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (!hasPermission(operator.role, action)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied: role "${operator.role}" does not have "${action}" permission`,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next();
  };
}
