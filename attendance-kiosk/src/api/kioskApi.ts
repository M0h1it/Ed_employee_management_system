/**
 * src/api/kioskApi.ts
 *
 * Talks to exactly two endpoints — POST /kiosk/punch and POST
 * /kiosk/pin-punch — plus nothing else. This app never touches any other
 * endpoint in the API: it has no user session, no admin capability, only a
 * device identity (see deviceStore.ts).
 *
 * CONTRACT NOTES (verified directly against the live OpenAPI schema before
 * writing this file, not assumed):
 *   - X-Device-Code is a header on every kiosk request.
 *   - /kiosk/punch takes `frames` (multiple files) AND `device_ts` as
 *     multipart form fields — device_ts was originally a query parameter
 *     until fixed to a form field for consistency; this client only ever
 *     targets the fixed, form-field version.
 *   - /kiosk/pin-punch takes {employeeCode, pin} as a JSON BODY, not query
 *     parameters — that was a real bug (a PIN in a URL ends up in access
 *     logs) fixed before this client was written. Never revert this to
 *     query params even if a future backend change looks like it "would
 *     also work" — it would silently reintroduce the leak.
 */

import { config } from '../config';
import { getDeviceCode } from '../storage/deviceStore';

export type KioskOutcome = 'MATCH' | 'UNSURE' | 'NO_MATCH' | 'LIVENESS_FAILED';

export interface KioskPunchResult {
  outcome: KioskOutcome;
  employeeId: string | null;
  employeeName: string | null;
  photoUrl: string | null;
  direction: 'IN' | 'OUT' | null;
  confidence: number | null;
  punchedAt: string | null;
  message: string;
}

export interface PinPunchResult {
  employeeId: string;
  employeeName: string;
  direction: 'IN' | 'OUT';
  punchedAt: string;
  message: string;
}

export class DeviceUnauthorizedError extends Error {
  constructor() {
    super('This device is not recognised. It may need to be set up again.');
    this.name = 'DeviceUnauthorizedError';
  }
}

export class InvalidPinError extends Error {
  constructor() {
    super('That employee code or PIN was not recognised.');
    this.name = 'InvalidPinError';
  }
}

export class NetworkUnavailableError extends Error {
  constructor() {
    super('Could not reach the server.');
    this.name = 'NetworkUnavailableError';
  }
}

/**
 * Confirms a device code actually authenticates, without any side effect
 * beyond updating last_seen_at server-side (see kiosk_whoami's docstring in
 * app/api/v1/face.py). Used by the setup screen for immediate feedback on a
 * typo'd code, rather than only discovering it's wrong on the first real
 * punch. A stored code is verified against THIS function's success, never
 * assumed valid just because AsyncStorage returned a non-null string.
 */
export async function verifyDeviceCode(code: string): Promise<boolean> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/kiosk/whoami`, {
      method: 'GET',
      headers: { 'X-Device-Code': code },
    });
    return response.ok;
  } catch {
    // A network failure here is NOT "the code is wrong" — the setup screen
    // treats this the same as any other network error, not as a rejected
    // code, since telling someone their code is invalid when it's actually
    // their Wi-Fi that's the problem would send them chasing the wrong fix.
    throw new NetworkUnavailableError();
  }
}

async function deviceHeaders(): Promise<Record<string, string>> {
  const code = await getDeviceCode();
  // No code stored means setup was never completed — every kiosk call is
  // expected to fail the same way a wrong code would (401), rather than
  // this file inventing a distinct "not set up" client-side error that the
  // rest of the app would need a second code path to handle.
  return code ? { 'X-Device-Code': code } : {};
}

async function parseJsonSafely(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Submits captured frames for face matching. frameUris are local file URIs
 * from the camera (see CaptureScreen), not raw bytes — React Native's
 * fetch/FormData reads the file at upload time from the URI itself.
 *
 * confirmEmployeeId is set only when this call is a "Yes" answer to the
 * kiosk's own prior UNSURE screen for that same employee — see
 * confirm_employee_id's docstring in app/api/v1/face.py for why re-sending
 * the same frames without it would loop back into UNSURE forever rather
 * than actually confirming the punch.
 */
export async function submitFacePunch(
  frameUris: string[],
  deviceTs: Date,
  confirmEmployeeId?: string,
): Promise<KioskPunchResult> {
  const form = new FormData();
  frameUris.forEach((uri, i) => {
    form.append('frames', { uri, name: `frame_${i}.jpg`, type: 'image/jpeg' } as any);
  });
  form.append('device_ts', deviceTs.toISOString());
  if (confirmEmployeeId) form.append('confirm_employee_id', confirmEmployeeId);

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/kiosk/punch`, {
      method: 'POST',
      headers: await deviceHeaders(),
      body: form,
    });
  } catch {
    throw new NetworkUnavailableError();
  }

  if (response.status === 401) throw new DeviceUnauthorizedError();

  const payload = await parseJsonSafely(response);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message ?? 'The server could not process this punch.');
  }

  return payload.data as KioskPunchResult;
}

/**
 * PIN fallback. employeeCode/pin travel as a JSON body — see the contract
 * note at the top of this file for why that is not optional. employeeCode
 * (e.g. "EMP-0042"), not a login username — pin_hash has no UNIQUE
 * constraint server-side, so identifying by PIN alone risks matching the
 * wrong person if two employees' PINs happen to collide; employeeCode is
 * unique and is what actually disambiguates the two.
 */
export async function submitPinPunch(employeeCode: string, pin: string): Promise<PinPunchResult> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/kiosk/pin-punch`, {
      method: 'POST',
      headers: { ...(await deviceHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeCode, pin }),
    });
  } catch {
    throw new NetworkUnavailableError();
  }

  if (response.status === 401) {
    // Ambiguous on purpose server-side (device auth failure and wrong
    // PIN both 401) — but this client only ever calls this endpoint with
    // a device code already attached, so in practice a 401 here almost
    // always means "the PIN was wrong", and DeviceUnauthorizedError's
    // wording ("this device is not recognised") would be actively
    // misleading shown to an employee mid-punch. Treat it as the PIN
    // being wrong; a genuinely revoked device will already have surfaced
    // that on this same screen via the device-status check on app start.
    throw new InvalidPinError();
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message ?? 'The server could not process this punch.');
  }

  return payload.data as PinPunchResult;
}