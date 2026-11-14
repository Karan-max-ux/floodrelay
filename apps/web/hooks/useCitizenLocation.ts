'use client';

import { useState, useRef } from 'react';
import type { GeocodeCandidate } from '@/app/api/geocode/route';

export type GpsStatus =
  'IDLE' | 'ACQUIRING' | 'ACQUIRED' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED';
export type ReverseGeocodeStatus = 'IDLE' | 'LOOKING_UP' | 'FOUND' | 'UNAVAILABLE' | 'ERROR';
export type GeocodeStatus = 'IDLE' | 'SEARCHING' | 'FOUND' | 'NO_MATCH' | 'ERROR';
export type LocationSource = 'NONE' | 'GPS' | 'GEOCODED' | 'MANUAL';

export interface ConfirmedLocationDetails {
  address: string;
  lat: string;
  lng: string;
  source: LocationSource;
  accuracy?: number | null;
}

export interface UseCitizenLocationOptions {
  onFieldEdited?: () => void;
  onErrorsClear?: (fields: string[]) => void;
  onSetError?: (field: string, message: string) => void;
}

export function useCitizenLocation(options: UseCitizenLocationOptions = {}) {
  const { onFieldEdited, onErrorsClear, onSetError } = options;

  // Form Location State (Empty by default — Houston/Delhi coordinates eliminated)
  const [address, setAddress] = useState<string>('');
  const [lat, setLat] = useState<string>('');
  const [lng, setLng] = useState<string>('');

  // GPS & Geocoding Process State
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('IDLE');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [reverseGeocodeStatus, setReverseGeocodeStatus] = useState<ReverseGeocodeStatus>('IDLE');
  const [reverseGeocodeMessage, setReverseGeocodeMessage] = useState<string | null>(null);

  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('IDLE');
  const [geocodeCandidates, setGeocodeCandidates] = useState<GeocodeCandidate[]>([]);
  const [geocodeMessage, setGeocodeMessage] = useState<string | null>(null);

  // Provenance & Confirmation State
  const [locationSource, setLocationSource] = useState<LocationSource>('NONE');
  const [isLocationConfirmed, setIsLocationConfirmed] = useState<boolean>(false);
  const [confirmedDetails, setConfirmedDetails] = useState<ConfirmedLocationDetails | null>(null);

  // Invalidation & Stale-Response Guards
  const lookupSeqRef = useRef<number>(0);
  const geocodeSeqRef = useRef<number>(0);
  const userEditedDuringLookupRef = useRef<boolean>(false);
  const userEditedAddressRef = useRef<boolean>(false);
  const geocodeAbortControllerRef = useRef<AbortController | null>(null);
  const lookupAbortControllerRef = useRef<AbortController | null>(null);

  const invalidateConfirmation = () => {
    setIsLocationConfirmed(false);
    setConfirmedDetails(null);
  };

  /**
   * Address input change handler:
   * - Immediately cancels in-flight forward-geocoding requests (abort signal + sequence increment).
   * - Clears stale suggested candidates.
   * - Resets geocoding status/messages.
   * - Invalidates existing location confirmation.
   */
  const handleAddressChange = (newVal: string) => {
    setAddress(newVal);
    userEditedDuringLookupRef.current = true;
    userEditedAddressRef.current = true;

    // Sequence increment & abort controller guarantee no pending search can resolve or populate
    geocodeSeqRef.current += 1;
    if (geocodeAbortControllerRef.current) {
      geocodeAbortControllerRef.current.abort();
      geocodeAbortControllerRef.current = null;
    }

    setGeocodeCandidates([]);
    if (
      geocodeStatus === 'SEARCHING' ||
      geocodeStatus === 'FOUND' ||
      geocodeStatus === 'NO_MATCH' ||
      geocodeStatus === 'ERROR'
    ) {
      setGeocodeStatus('IDLE');
      setGeocodeMessage(null);
    }

    invalidateConfirmation();
    onFieldEdited?.();
  };

  /**
   * Coordinate input change handler (manual coordinate entry):
   * - Keeps user's manually edited coordinates.
   * - Preserves the manually entered address.
   * - Increments lookupSeqRef.current to invalidate all pending reverse-geocoding responses.
   * - Cancels the pending reverse-geocoding request using AbortController.
   * - Marks any in-flight reverse-geocoding result as obsolete.
   * - Resets reverse-geocoding loading indicators and stale messages.
   * - Sets locationSource = 'MANUAL'.
   * - Sets isLocationConfirmed = false and clears confirmedDetails.
   */
  const handleCoordinateChange = (field: 'lat' | 'lng', newVal: string) => {
    if (field === 'lat') setLat(newVal);
    else setLng(newVal);

    // 1. Invalidate pending reverse-geocoding responses
    lookupSeqRef.current += 1;

    // 2. Cancel in-flight reverse-geocoding request via AbortController
    if (lookupAbortControllerRef.current) {
      lookupAbortControllerRef.current.abort();
      lookupAbortControllerRef.current = null;
    }

    // 3. Mark in-flight result as obsolete
    userEditedDuringLookupRef.current = true;

    // 4. Reset loading indicators and stale reverse-geocoding messages
    setReverseGeocodeStatus('IDLE');
    setReverseGeocodeMessage(null);

    // 5. Update provenance and invalidate confirmation
    setLocationSource('MANUAL');
    invalidateConfirmation();
    onFieldEdited?.();
  };

  /**
   * METHOD A: Forward Geocoding (Manual Address Search)
   */
  const handleSearchAddress = async (overrideQuery?: string) => {
    const query = (overrideQuery ?? address).trim();

    if (!query) {
      onSetError?.('address', 'Street address or location landmark is required to search');
      return;
    }

    if (query.length < 3) {
      onSetError?.('address', 'Please enter at least 3 characters to search for a location');
      return;
    }

    onErrorsClear?.(['address', 'location']);

    // Abort previous in-flight search if active
    if (geocodeAbortControllerRef.current) {
      geocodeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    geocodeAbortControllerRef.current = abortController;

    const seq = ++geocodeSeqRef.current;
    userEditedAddressRef.current = false;
    setGeocodeStatus('SEARCHING');
    setGeocodeMessage('Searching location for address...');
    setGeocodeCandidates([]);

    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: query }),
        signal: abortController.signal,
      });

      // Ignore stale network responses from previous searches
      if (seq !== geocodeSeqRef.current) {
        return;
      }

      const data = await res.json().catch(() => null);

      if (seq !== geocodeSeqRef.current) {
        return;
      }

      if (res.ok && data?.success) {
        const results: GeocodeCandidate[] = Array.isArray(data.results) ? data.results : [];
        if (results.length === 0) {
          setGeocodeStatus('NO_MATCH');
          setGeocodeMessage(
            data?.message ||
              "We couldn't verify this address. Please provide a more precise address, add a nearby landmark or city, or use GPS.",
          );
        } else {
          setGeocodeStatus('FOUND');
          setGeocodeCandidates(results);
          setGeocodeMessage(
            results.length === 1
              ? 'Location match found. Please verify and confirm:'
              : 'Multiple locations found. Please select and confirm the correct one:',
          );
        }
      } else {
        setGeocodeStatus('ERROR');
        setGeocodeMessage(
          data?.message ||
            'Unable to determine location for this address. Please refine your search or use GPS.',
        );
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        return;
      }
      if (seq !== geocodeSeqRef.current) return;
      setGeocodeStatus('ERROR');
      setGeocodeMessage(
        'Network error looking up address. Please check your connection or use GPS.',
      );
    }
  };

  /**
   * Candidate Selection Handler:
   * Selects candidate, populates coordinates, marks confirmed, and clears candidates list.
   */
  const handleSelectCandidate = (candidate: GeocodeCandidate) => {
    const formattedLat = candidate.lat.toFixed(6);
    const formattedLng = candidate.lng.toFixed(6);

    setAddress(candidate.formatted);
    setLat(formattedLat);
    setLng(formattedLng);
    setLocationSource('GEOCODED');
    setIsLocationConfirmed(true);
    setConfirmedDetails({
      address: candidate.formatted,
      lat: formattedLat,
      lng: formattedLng,
      source: 'GEOCODED',
    });

    setGeocodeCandidates([]);
    setGeocodeStatus('FOUND');
    setGeocodeMessage(null);
    userEditedAddressRef.current = false;
    onFieldEdited?.();
    onErrorsClear?.(['address', 'lat', 'lng', 'location']);
  };

  /**
   * Reverse Geocoding for GPS Coordinates:
   * Populates coordinates and street address, but KEEPS isLocationConfirmed=false
   * until explicit citizen confirmation.
   * Uses AbortController and sequence counter to prevent stale or race-condition responses.
   */
  const triggerReverseGeocode = async (latNum: number, lngNum: number) => {
    // Abort prior in-flight reverse-geocoding request
    if (lookupAbortControllerRef.current) {
      lookupAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    lookupAbortControllerRef.current = abortController;

    const seq = ++lookupSeqRef.current;
    userEditedDuringLookupRef.current = false;
    setReverseGeocodeStatus('LOOKING_UP');
    setReverseGeocodeMessage('Finding nearest street address...');

    try {
      const res = await fetch('/api/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lat: latNum, lng: lngNum }),
        signal: abortController.signal,
      });

      // Reject stale response from older GPS triggers or user coordinate/address modifications
      if (seq !== lookupSeqRef.current || userEditedDuringLookupRef.current) {
        return;
      }

      const data = await res.json().catch(() => null);

      // Recheck sequence guard and user-edit flag after body parsing
      if (seq !== lookupSeqRef.current || userEditedDuringLookupRef.current) {
        return;
      }

      if (res.ok && data?.success) {
        if (data.address && typeof data.address === 'string' && data.address.trim()) {
          const formattedAddress = data.address.trim();
          setAddress(formattedAddress);
          setReverseGeocodeStatus('FOUND');
          setReverseGeocodeMessage(null);

          // REQUIREMENT: Automatically populate coordinates and address,
          // but KEEP isLocationConfirmed=false until citizen explicitly confirms.
          setIsLocationConfirmed(false);
          setConfirmedDetails(null);

          onFieldEdited?.();
          onErrorsClear?.(['address', 'lat', 'lng']);
        } else {
          setReverseGeocodeStatus('UNAVAILABLE');
          const baseMsg = data?.message || 'No street address found for these coordinates.';
          setReverseGeocodeMessage(
            baseMsg.includes('manually')
              ? baseMsg
              : `${baseMsg} Coordinates are saved — please enter your street address or landmark manually.`,
          );
        }
      } else {
        setReverseGeocodeStatus('ERROR');
        const baseMsg = data?.message || 'Unable to determine street address.';
        setReverseGeocodeMessage(
          baseMsg.includes('manually')
            ? baseMsg
            : `${baseMsg} Coordinates are saved — please enter your street address or landmark manually.`,
        );
      }
    } catch (err: unknown) {
      // Gracefully handle abort without showing false network-error message
      if ((err as Error)?.name === 'AbortError') {
        return;
      }
      if (seq !== lookupSeqRef.current || userEditedDuringLookupRef.current) {
        return;
      }
      setReverseGeocodeStatus('ERROR');
      setReverseGeocodeMessage(
        'Network error looking up address. Coordinates are saved — please enter your street address or landmark manually.',
      );
    }
  };

  /**
   * METHOD B: Browser Geolocation (Use My Current Location)
   */
  const handleUseLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('UNSUPPORTED');
      return;
    }

    setGpsStatus('ACQUIRING');
    invalidateConfirmation();

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const formattedLat = pos.coords.latitude.toFixed(6);
        const formattedLng = pos.coords.longitude.toFixed(6);
        setLat(formattedLat);
        setLng(formattedLng);
        setGpsAccuracy(pos.coords.accuracy);
        setGpsStatus('ACQUIRED');
        setLocationSource('GPS');
        setIsLocationConfirmed(false);
        setConfirmedDetails(null);
        onFieldEdited?.();
        onErrorsClear?.(['lat', 'lng', 'location']);

        // Reverse-geocode to find nearest street address
        void triggerReverseGeocode(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        // Strict geolocation error handling: NO fake/ Houston fallback coordinates
        if (err.code === 1) {
          setGpsStatus('DENIED');
        } else if (err.code === 3) {
          setGpsStatus('TIMEOUT');
        } else {
          setGpsStatus('UNAVAILABLE');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  /**
   * Explicit confirmation button handler (e.g. after GPS autofill or manual edits)
   */
  const handleExplicitConfirm = (): boolean => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    let hasError = false;

    if (!address.trim()) {
      onSetError?.(
        'address',
        'Street address or location landmark is required to confirm location',
      );
      hasError = true;
    }
    if (!lat.trim() || isNaN(latNum) || latNum < -90 || latNum > 90) {
      onSetError?.('lat', 'Valid latitude between -90 and 90 is required');
      hasError = true;
    }
    if (!lng.trim() || isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      onSetError?.('lng', 'Valid longitude between -180 and 180 is required');
      hasError = true;
    }

    if (hasError) {
      return false;
    }

    setIsLocationConfirmed(true);
    setConfirmedDetails({
      address: address.trim(),
      lat: latNum.toFixed(6),
      lng: lngNum.toFixed(6),
      source: locationSource === 'NONE' ? 'MANUAL' : locationSource,
      accuracy: locationSource === 'GPS' ? gpsAccuracy : null,
    });

    onErrorsClear?.(['address', 'lat', 'lng', 'location']);
    onFieldEdited?.();
    return true;
  };

  return {
    address,
    setAddress,
    lat,
    setLat,
    lng,
    setLng,
    gpsStatus,
    setGpsStatus,
    gpsAccuracy,
    setGpsAccuracy,
    reverseGeocodeStatus,
    setReverseGeocodeStatus,
    reverseGeocodeMessage,
    setReverseGeocodeMessage,
    geocodeStatus,
    setGeocodeStatus,
    geocodeCandidates,
    setGeocodeCandidates,
    geocodeMessage,
    setGeocodeMessage,
    locationSource,
    setLocationSource,
    isLocationConfirmed,
    setIsLocationConfirmed,
    confirmedDetails,
    setConfirmedDetails,
    lookupSeqRef,
    geocodeSeqRef,
    userEditedDuringLookupRef,
    userEditedAddressRef,
    geocodeAbortControllerRef,
    lookupAbortControllerRef,
    handleAddressChange,
    handleCoordinateChange,
    handleSearchAddress,
    handleSelectCandidate,
    handleUseLocation,
    triggerReverseGeocode,
    handleExplicitConfirm,
    invalidateConfirmation,
  };
}
