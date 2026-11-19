import { EN_IN_MESSAGES } from './en-IN';
import { HI_IN_MESSAGES_DRAFT, HI_IN_REVIEW_STATUS } from './hi-IN';
import type { CitizenMessages, LocaleDescriptor, SupportedLocale } from './types';

export type { CitizenMessages, LocaleDescriptor, SupportedLocale } from './types';
export { EN_IN_MESSAGES } from './en-IN';
export { HI_IN_MESSAGES_DRAFT, HI_IN_REVIEW_STATUS } from './hi-IN';

export const DEFAULT_LOCALE: SupportedLocale = 'en-IN';

export const LOCALE_CATALOGUE: Record<SupportedLocale, LocaleDescriptor> = {
  'en-IN': {
    code: 'en-IN',
    label: 'English (India)',
    nativeLabel: 'English (India)',
    enabled: true,
    reviewStatus: 'VERIFIED',
    reviewNote: 'Default active locale for Delhi NCR citizen and operator interfaces.',
  },
  'hi-IN': {
    code: 'hi-IN',
    label: 'Hindi (India)',
    nativeLabel: 'हिन्दी (भारत)',
    enabled: false,
    reviewStatus: HI_IN_REVIEW_STATUS,
    reviewNote:
      'Disabled until native human review and QA testing of emergency guidance, form validation, and receipt messaging are completed.',
  },
};

export function isLocaleEnabled(locale: SupportedLocale): boolean {
  return Boolean(LOCALE_CATALOGUE[locale]?.enabled);
}

/**
 * Resolves a requested locale to an active, reviewed locale.
 * Disabled or unreviewed locales (such as hi-IN while pending human review)
 * always fall back to DEFAULT_LOCALE ('en-IN').
 */
export function resolveActiveLocale(requested?: string | null): SupportedLocale {
  if (requested === 'hi-IN' && isLocaleEnabled('hi-IN')) {
    return 'hi-IN';
  }
  return DEFAULT_LOCALE;
}

/**
 * Returns the citizen message dictionary for the active locale, falling back
 * to EN_IN_MESSAGES for any disabled locale or unreviewed key.
 */
export function getCitizenMessages(requested?: SupportedLocale | string | null): CitizenMessages {
  const active = resolveActiveLocale(requested);
  if (active === 'en-IN') {
    return EN_IN_MESSAGES;
  }

  return {
    emergency: { ...EN_IN_MESSAGES.emergency, ...HI_IN_MESSAGES_DRAFT.emergency },
    home: { ...EN_IN_MESSAGES.home, ...HI_IN_MESSAGES_DRAFT.home },
    request: { ...EN_IN_MESSAGES.request, ...HI_IN_MESSAGES_DRAFT.request },
    validation: { ...EN_IN_MESSAGES.validation, ...HI_IN_MESSAGES_DRAFT.validation },
    confirmation: { ...EN_IN_MESSAGES.confirmation, ...HI_IN_MESSAGES_DRAFT.confirmation },
    serviceArea: { ...EN_IN_MESSAGES.serviceArea, ...HI_IN_MESSAGES_DRAFT.serviceArea },
  };
}
