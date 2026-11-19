import type { CitizenMessages } from './types';

/**
 * Hindi (hi-IN) citizen message bundle scaffold.
 *
 * STATUS: PENDING_HUMAN_REVIEW — DISABLED IN UI.
 *
 * Do NOT enable a user-facing Hindi language selector until a qualified native
 * Hindi reviewer has authored, verified, and tested every emergency instruction,
 * non-deployment disclaimer, form label, and validation message in this bundle.
 * Machine-generated translations must not be published for safety-critical
 * emergency guidance without human sign-off.
 */
export type PartialCitizenMessages = {
  [Section in keyof CitizenMessages]?: Partial<CitizenMessages[Section]>;
};

export const HI_IN_REVIEW_STATUS = 'PENDING_HUMAN_REVIEW' as const;

export const HI_IN_MESSAGES_DRAFT: PartialCitizenMessages = {
  // Intentionally unpopulated pending qualified human Hindi review of
  // safety-critical emergency guidance, validation messages, and receipts.
};
