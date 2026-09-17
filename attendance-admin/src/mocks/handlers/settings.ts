/**
 * src/mocks/handlers/settings.ts
 *
 * Own profile, own password, and company-wide attendance policy.
 *
 * NOTE THE ASYMMETRY WITH ADMIN RESET: changing your OWN password requires the
 * current one. An admin resetting somebody ELSE's does not, because the whole
 * point is that the person has forgotten it. Two operations, two rules. Letting
 * a self-service change skip the current password would mean anyone who found
 * an unlocked laptop could lock the real owner out.
 */

import { http, HttpResponse, delay } from 'msw';
import { EP } from '@/contracts/endpoints';
import type { OrgSettings, OrgSettingsUpdate, ShiftPolicyVersion, UpdateProfileRequest, Single } from '@/contracts/types';
import { employees } from '../fixtures/employees';
import { users, mockPasswords } from '../fixtures/users';
import { shifts } from '../fixtures/org';

/** The signed-in user, for the mock. Real auth reads this from the token. */
function currentUser() {
  return users.find((u) => mockPasswords[u.username] !== undefined) ?? users[0];
}

// In-memory version history for the mock — mirrors what the real backend's
// shift_policy_versions table accumulates, so OrgPanel's history list has
// something to render in mock mode too.
const mockPolicyHistory: ShiftPolicyVersion[] = [];

export const settingsHandlers = [
  http.get(EP.org.settings, async () => {
    await delay(200);
    const shift = shifts[0];
    const body: Single<OrgSettings> = {
      data: {
        shiftStart: shift.startTime,
        shiftEnd: shift.endTime,
        graceMinutes: shift.graceMinutes,
        minHours: shift.minHours,
        companyName: 'SmartPunch',
      },
    };
    return HttpResponse.json(body);
  }),

  http.get(EP.org.settingsHistory, async () => {
    await delay(150);
    const body: Single<ShiftPolicyVersion[]> = {
      data: [...mockPolicyHistory].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    };
    return HttpResponse.json(body);
  }),

  http.patch(EP.org.settings, async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as OrgSettingsUpdate;
    const shift = shifts[0];

    if (body.shiftStart) shift.startTime = body.shiftStart;
    if (body.shiftEnd) shift.endTime = body.shiftEnd;
    if (body.graceMinutes !== undefined) shift.graceMinutes = body.graceMinutes;
    if (body.minHours !== undefined) shift.minHours = body.minHours;

    // Same upsert-by-effectiveFrom the real endpoint does — saving twice for
    // the same date replaces that version rather than duplicating it.
    const effectiveFrom = body.effectiveFrom ?? new Date().toISOString().slice(0, 10);
    const existingIndex = mockPolicyHistory.findIndex((v) => v.effectiveFrom === effectiveFrom);
    const version: ShiftPolicyVersion = {
      id: existingIndex >= 0 ? mockPolicyHistory[existingIndex].id : `version-${mockPolicyHistory.length + 1}`,
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
      graceMinutes: shift.graceMinutes,
      minHours: shift.minHours,
      effectiveFrom,
      createdAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      mockPolicyHistory[existingIndex] = version;
    } else {
      mockPolicyHistory.push(version);
    }

    const responseBody: Single<OrgSettings> = {
      data: {
        shiftStart: shift.startTime,
        shiftEnd: shift.endTime,
        graceMinutes: shift.graceMinutes,
        minHours: shift.minHours,
        companyName: 'SmartPunch',
      },
    };
    return HttpResponse.json(responseBody);
  }),

  http.patch(EP.auth.profile, async ({ request }) => {
    await delay(350);
    const body = (await request.json()) as UpdateProfileRequest;
    const user = currentUser();
    const employee = employees.find((e) => e.id === user.employeeId);

    if (!employee) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Profile not found.' } },
        { status: 404 },
      );
    }

    const fields: Record<string, string> = {};
    if (body.phone && !/^[6-9]\d{9}$/.test(body.phone)) {
      fields.phone = 'Enter a valid 10-digit mobile number';
    }
    if (
      body.email &&
      employees.some(
        (e) => e.id !== employee.id && e.email.toLowerCase() === body.email!.toLowerCase(),
      )
    ) {
      fields.email = 'This email is already in use';
    }
    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Please fix the highlighted fields.', fields } },
        { status: 422 },
      );
    }

    if (body.phone) employee.phone = body.phone;
    if (body.email) employee.email = body.email;

    return HttpResponse.json({ data: employee });
  }),

  http.patch(EP.auth.changePassword, async ({ request }) => {
    await delay(450);
    const body = (await request.json()) as {
      currentPassword: string;
      newPassword: string;
    };
    const user = currentUser();

    if (mockPasswords[user.username] !== body.currentPassword) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please fix the highlighted fields.',
            fields: { currentPassword: 'That is not your current password' },
          },
        },
        { status: 422 },
      );
    }

    if (!body.newPassword || body.newPassword.length < 8) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please fix the highlighted fields.',
            fields: { newPassword: 'Use at least 8 characters' },
          },
        },
        { status: 422 },
      );
    }

    if (body.newPassword === body.currentPassword) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please fix the highlighted fields.',
            fields: { newPassword: 'Choose a password you have not used before' },
          },
        },
        { status: 422 },
      );
    }

    mockPasswords[user.username] = body.newPassword;
    user.mustChangePassword = false;

    // 204: nothing to return, and nothing that could leak.
    return new HttpResponse(null, { status: 204 });
  }),
];