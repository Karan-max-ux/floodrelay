import type { CitizenMessages } from './types';

/**
 * Verified Indian English (en-IN) copy for citizen-critical FloodRelay screens.
 */
export const EN_IN_MESSAGES: CitizenMessages = {
  emergency: {
    bannerLabel: 'India emergency helpline:',
    callCta: 'Call 112 Now',
    headerCallCta: 'Call 112',
    immediateDangerNote:
      'In immediate, life-threatening danger, call 112 directly. FloodRelay does not replace official emergency services.',
    prototypeDisclaimer:
      'Report your location and rescue needs to FloodRelay for operator review. This prototype does not directly dispatch emergency services.',
    footerGuidance:
      'Delhi-focused rescue decision-support prototype. In immediate danger, call 112.',
  },
  home: {
    regionBadge: 'FloodRelay • Delhi Region',
    regionStatusNoFeed: 'Delhi–Yamuna Floodplain • No live water-level feed',
    heroHeadline: 'Flood Rescue Request Intake — Delhi NCR',
    heroSubtitle:
      'Report your location and rescue needs to FloodRelay for operator review. This prototype does not directly dispatch emergency services.',
    requestAssistanceCta: 'Request Rescue Assistance',
    workflowHeading: 'Three Steps from Request to Response Planning',
    step2Footer: 'Operator review workflow',
    step3Disclaimer:
      'If an authorised rescue team accepts the request, it may use the recorded location to plan a response. Submission does not guarantee deployment.',
  },
  request: {
    pageTitle: 'Request Flood Rescue Assistance',
    pageSubtitle:
      'Submit your rescue needs to FloodRelay for operator review. Enter an address or use your device GPS to provide your location.',
    intakeStatus: 'FloodRelay request form available. Submission requires API connectivity.',
    addressPlaceholder: 'e.g., House 24, Civil Lines, near Metro Station, Delhi',
    latPlaceholder: 'e.g. 28.6710',
    lngPlaceholder: 'e.g. 77.2340',
    notesPlaceholder:
      'e.g., White cloth tied to terrace railing; please approach from Ring Road side to avoid submerged lane.',
    submitCta: 'Submit Rescue Request',
    submitImmediateDanger:
      'Request details are submitted to FloodRelay. In immediate danger, call 112.',
  },
  validation: {
    latRequired:
      'Latitude is required. Use "Find Location", "Use My Current Location", or enter coordinates.',
    latRange: 'Valid latitude between -90 and 90 is required',
    lngRequired:
      'Longitude is required. Use "Find Location", "Use My Current Location", or enter coordinates.',
    lngRange: 'Valid longitude between -180 and 180 is required',
    addressRequired: 'Street address or location landmark is required',
    locationConfirmationRequired:
      'Please verify and confirm your location before submitting. Use "Find Location" or click "Confirm Location".',
    waterLevelRequired: 'Please select the current water level situation',
    partyCountMin: 'At least 1 person must be reported',
  },
  confirmation: {
    receiptBadge: 'FLOODRELAY REQUEST RECEIPT',
    prototypeReceiptNote:
      'This receipt confirms that FloodRelay recorded your request for operator review. It does not guarantee physical rescue deployment.',
    returnHomeCta: 'Return to Citizen Home',
    submitAnotherCta: 'Submit Another Request',
  },
  serviceArea: {
    outsideHeading: "Location Outside FloodRelay's Service Area",
    outsideP1:
      'FloodRelay currently accepts rescue assistance requests only for locations within its supported Delhi NCR area.',
    outsideP2:
      'Your selected location is outside this area, so no rescue request has been submitted or assigned.',
    outsideP3:
      'If you are in immediate danger in India, please call 112 for emergency assistance. You can also contact your local emergency services.',
    outsideP4:
      'If your location was detected incorrectly, correct your address or coordinates and try again.',
    unavailableHeading: 'Service-Area Check Temporarily Unavailable',
    unavailableP1:
      'FloodRelay is temporarily unable to verify whether your location is inside its supported Delhi NCR service area. Your entered information has been preserved.',
    unavailableP2:
      'If you are in immediate danger, please call 112 directly. Otherwise, please try the location check again in a moment.',
    eligibleNotice: 'Location verified inside FloodRelay Delhi NCR service area.',
    call112Cta: 'Call 112',
    changeLocationCta: 'Change Location',
    tryAgainCta: 'Try Location Check Again',
  },
};
