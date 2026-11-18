export type SupportedLocale = 'en-IN' | 'hi-IN';

export type LocaleReviewStatus = 'VERIFIED' | 'PENDING_HUMAN_REVIEW';

export interface LocaleDescriptor {
  code: SupportedLocale;
  label: string;
  nativeLabel: string;
  enabled: boolean;
  reviewStatus: LocaleReviewStatus;
  reviewNote: string;
}

/**
 * Shared translation keys covering citizen-critical screens:
 * - Home
 * - Request form
 * - Input validation
 * - Emergency guidance
 * - Confirmation / receipt
 */
export interface CitizenMessages {
  emergency: {
    bannerLabel: string;
    callCta: string;
    headerCallCta: string;
    immediateDangerNote: string;
    prototypeDisclaimer: string;
    footerGuidance: string;
  };
  home: {
    regionBadge: string;
    regionStatusNoFeed: string;
    heroHeadline: string;
    heroSubtitle: string;
    requestAssistanceCta: string;
    workflowHeading: string;
    step2Footer: string;
    step3Disclaimer: string;
  };
  request: {
    pageTitle: string;
    pageSubtitle: string;
    intakeStatus: string;
    addressPlaceholder: string;
    latPlaceholder: string;
    lngPlaceholder: string;
    notesPlaceholder: string;
    submitCta: string;
    submitImmediateDanger: string;
  };
  validation: {
    latRequired: string;
    latRange: string;
    lngRequired: string;
    lngRange: string;
    addressRequired: string;
    locationConfirmationRequired: string;
    waterLevelRequired: string;
    partyCountMin: string;
  };
  confirmation: {
    receiptBadge: string;
    prototypeReceiptNote: string;
    returnHomeCta: string;
    submitAnotherCta: string;
  };
}
