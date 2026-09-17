/**
 * src/mocks/handlers/users.ts
 *
 * Login accounts: create, reset password, enable and disable.
 *
 * WHAT NEVER APPEARS IN A RESPONSE: the password. Not on create, not on read,
 * not hashed, not partially. The admin sees the temporary password once, in the
 * form they typed it into, and after that it is unrecoverable — only
 * resettable. Any endpoint that returns a password is a breach waiting to be
 * logged, cached or screenshotted.
 */

import { http, HttpResponse, delay } from 'msw';
import { EP, EP_PATTERNS } from '@/contracts/endpoints';
import type {
  User,
  UserId,
  RoleId,
  EmployeeId,
  CreateUserRequest,
  ResetPasswordRequest,
  Paginated,
  Single,
} from '@/contracts/types';
import { users, mockPasswords } from '../fixtures/users';
import { findRole, roles } from '../fixtures/roles';
import { employees, findEmployee } from '../fixtures/employees';
import { currentActor } from './auth';
import type { ChangeRoleRequest } from '@/contracts/types';

/**
 * WHO MAY MOVE WHOM
 * -----------------
 * Three rules, all enforced here on the server. The UI hides what it can, but
 * hiding a dropdown stops nobody from calling this endpoint directly, and the
 * failure mode is somebody handing themselves every permission in the system.
 *
 * 1. SUBSET — you may only assign a role whose permissions you already hold.
 *    A manager cannot hand out `roles.manage` because they do not have it.
 *    This one rule prevents escalation without any hard-coded hierarchy.
 * 2. NOT YOURSELF — self-promotion is otherwise a single request.
 * 3. NOT A PEER — you cannot move someone who also holds `users.change_role`,
 *    unless you hold `roles.manage` (in practice, the owner). Without this,
 *    two managers could demote each other, or collude upward in two steps.
 */
function roleChangeError(
  actorPermissions: string[],
  targetUserId: string,
  actorUserId: string,
  newRoleId: string,
): { status: number; code: string; message: string } | null {
  if (!actorPermissions.includes('users.change_role')) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to change roles.',
    };
  }

  if (targetUserId === actorUserId) {
    return {
      status: 403,
      code: 'SELF_ROLE_CHANGE',
      message: 'You cannot change your own role. Ask someone with higher access.',
    };
  }

  const target = users.find((u) => u.id === targetUserId);
  const targetRole = target ? findRole(target.roleId) : null;
  const isOwnerLevel = actorPermissions.includes('roles.manage');

  if (
    targetRole?.permissions.includes('users.change_role') &&
    !isOwnerLevel
  ) {
    return {
      status: 403,
      code: 'PEER_ROLE_CHANGE',
      message:
        'This person can already change roles themselves. Only an owner can move them.',
    };
  }

  const newRole = findRole(newRoleId);
  if (!newRole) {
    return { status: 404, code: 'NOT_FOUND', message: 'That role does not exist.' };
  }

  const escalating = newRole.permissions.filter((p) => !actorPermissions.includes(p));
  if (escalating.length > 0) {
    return {
      status: 403,
      code: 'ESCALATION',
      message: `You cannot grant access you do not have yourself (${escalating
        .slice(0, 3)
        .join(', ')}${escalating.length > 3 ? '…' : ''}).`,
    };
  }

  return null;
}

export const userHandlers = [
  http.get(EP.users.list, async ({ request }) => {
    await delay(300);
    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const roleId = url.searchParams.get('roleId') ?? '';
    const employeeId = url.searchParams.get('employeeId') ?? '';
    const isActive = url.searchParams.get('isActive');
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);

    let rows = [...users];
    if (search) {
      rows = rows.filter(
        (u) =>
          u.username.toLowerCase().includes(search) ||
          u.employeeName.toLowerCase().includes(search),
      );
    }
    if (roleId) rows = rows.filter((u) => u.roleId === roleId);
    if (employeeId) rows = rows.filter((u) => u.employeeId === employeeId);
    if (isActive !== null && isActive !== '') {
      rows = rows.filter((u) => u.isActive === (isActive === 'true'));
    }

    rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const body: Paginated<User> = {
      data: rows.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
    return HttpResponse.json(body);
  }),

  http.post(EP.users.list, async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as CreateUserRequest;

    const employee = findEmployee(body.employeeId);
    const role = findRole(body.roleId);

    const fields: Record<string, string> = {};
    if (!employee) fields.employeeId = 'Choose an employee';
    if (!role) fields.roleId = 'Choose a role';
    if (!body.username?.trim()) fields.username = 'Username is required';
    if (users.some((u) => u.username.toLowerCase() === body.username?.toLowerCase())) {
      fields.username = 'This username is taken';
    }
    if (employee && users.some((u) => u.employeeId === employee.id)) {
      fields.employeeId = 'This person already has a login';
    }
    if (!body.temporaryPassword || body.temporaryPassword.length < 8) {
      fields.temporaryPassword = 'Use at least 8 characters';
    }
    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Please fix the highlighted fields.', fields } },
        { status: 422 },
      );
    }

    const user: User = {
      id: `user-${String(users.length + 1).padStart(2, '0')}` as UserId,
      employeeId: employee!.id as EmployeeId,
      employeeName: employee!.name,
      employeePhotoUrl: employee!.photoUrl,
      username: body.username.trim(),
      roleId: role!.id as RoleId,
      roleName: role!.name,
      isActive: true,
      mustChangePassword: body.mustChangePassword,
      hasPinSet: false, // a newly created account has no PIN generated yet
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    mockPasswords[user.username] = body.temporaryPassword; // mock only

    // Keep the directory in sync so the employee list shows the new account.
    const listed = employees.find((e) => e.id === employee!.id);
    if (listed) {
      listed.hasLogin = true;
      listed.roleName = role!.name;
    }

    const responseBody: Single<User> = { data: user };
    return HttpResponse.json(responseBody, { status: 201 });
  }),

  http.patch(EP_PATTERNS.userPassword, async ({ params, request }) => {
    await delay(400);
    const user = users.find((u) => u.id === String(params.id));
    if (!user) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Account not found.' } },
        { status: 404 },
      );
    }

    const body = (await request.json()) as ResetPasswordRequest;
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

    mockPasswords[user.username] = body.newPassword;
    user.mustChangePassword = body.mustChangePassword;

    // 204: the reset worked and there is nothing to send back. Returning the
    // user object here would tempt somebody to include the password in it.
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch(EP_PATTERNS.userStatus, async ({ params, request }) => {
    await delay(250);
    const user = users.find((u) => u.id === String(params.id));
    if (!user) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Account not found.' } },
        { status: 404 },
      );
    }

    const body = (await request.json()) as { isActive: boolean };

    // Disabling the last account that can manage users locks everyone out.
    if (!body.isActive) {
      const role = findRole(user.roleId);
      if (role?.permissions.includes('users.manage')) {
        const othersWhoCan = users.filter((u) => {
          if (u.id === user.id || !u.isActive) return false;
          return findRole(u.roleId)?.permissions.includes('users.manage');
        });
        if (othersWhoCan.length === 0) {
          return HttpResponse.json(
            {
              error: {
                code: 'LAST_ADMIN',
                message: 'This is the last active account that can manage users.',
              },
            },
            { status: 409 },
          );
        }
      }
    }

    user.isActive = body.isActive;
    const responseBody: Single<User> = { data: user };
    return HttpResponse.json(responseBody);
  }),

  http.patch(EP_PATTERNS.userRole, async ({ params, request }) => {
    await delay(350);

    const actor = currentActor();
    if (!actor) {
      return HttpResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Not signed in.' } },
        { status: 401 },
      );
    }

    const actorRole = findRole(actor.roleId);
    const actorPermissions = actorRole?.permissions ?? [];
    const body = (await request.json()) as ChangeRoleRequest;
    const targetId = String(params.id);

    const failure = roleChangeError(actorPermissions, targetId, actor.id, body.roleId);
    if (failure) {
      return HttpResponse.json(
        { error: { code: failure.code, message: failure.message } },
        { status: failure.status },
      );
    }

    const user = users.find((u) => u.id === targetId)!;
    const newRole = findRole(body.roleId)!;

    user.roleId = newRole.id;
    user.roleName = newRole.name;

    // Keep the directory in step, so the employee list does not show the old
    // role until something else happens to refetch it.
    const listed = employees.find((e) => e.id === user.employeeId);
    if (listed) listed.roleName = newRole.name;

    const responseBody: Single<User> = { data: user };
    return HttpResponse.json(responseBody);
  }),

  /** Which roles the signed-in person is allowed to hand out. */
  http.get(`${EP.roles.list}/assignable`, async () => {
    await delay(150);
    const actor = currentActor();
    const actorRole = actor ? findRole(actor.roleId) : null;
    const actorPermissions = actorRole?.permissions ?? [];

    const assignable = roles.filter((r) =>
      r.permissions.every((p) => actorPermissions.includes(p)),
    );
    return HttpResponse.json({ data: assignable });
  }),
];