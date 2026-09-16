/**
 * src/mocks/handlers/roles.ts
 *
 * Role management.
 *
 * TWO GUARDS WORTH NOTICING
 * --------------------------
 * 1. A system role cannot be deleted or renamed. Without that, someone deletes
 *    "Owner" on a Friday and nobody can administer the system on Monday.
 * 2. The last remaining roles.manage permission cannot be removed. Otherwise
 *    an owner can lock themselves — and everyone else — out of role management
 *    permanently, with no way back through the UI.
 *
 * Both are the kind of rule that only gets added after it has happened once.
 */

import { http, HttpResponse, delay } from 'msw';
import { EP, EP_PATTERNS } from '@/contracts/endpoints';
import type {
  Role,
  RoleId,
  CreateRoleRequest,
  UpdateRoleRequest,
  Single,
} from '@/contracts/types';
import { PERMISSIONS, PERMISSION_MODULES } from '@/contracts/permissions';
import { roles, findRole } from '../fixtures/roles';
import { users } from '../fixtures/users';

function withCounts(role: Role): Role {
  return { ...role, userCount: users.filter((u) => u.roleId === role.id).length };
}

export const roleHandlers = [
  http.get(EP.roles.list, async () => {
    await delay(250);
    const body: Single<Role[]> = { data: roles.map(withCounts) };
    return HttpResponse.json(body);
  }),

  http.get(EP.permissions.catalogue, async () => {
    await delay(150);
    return HttpResponse.json({
      data: { all: PERMISSIONS, modules: PERMISSION_MODULES },
    });
  }),

  http.post(EP.roles.list, async ({ request }) => {
    await delay(350);
    const body = (await request.json()) as CreateRoleRequest;

    const fields: Record<string, string> = {};
    if (!body.name?.trim()) fields.name = 'Name is required';
    if (roles.some((r) => r.name.toLowerCase() === body.name?.trim().toLowerCase())) {
      fields.name = 'A role with this name already exists';
    }
    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Please fix the highlighted fields.', fields } },
        { status: 422 },
      );
    }

    const role: Role = {
      id: `role-${body.name.toLowerCase().replace(/\s+/g, '-')}` as RoleId,
      name: body.name.trim(),
      description: body.description ?? '',
      isSystem: false,
      permissions: body.permissions ?? [],
      userCount: 0,
    };
    roles.push(role);

    const responseBody: Single<Role> = { data: role };
    return HttpResponse.json(responseBody, { status: 201 });
  }),

  http.patch(EP_PATTERNS.roleDetail, async ({ params, request }) => {
    await delay(300);
    const role = findRole(String(params.id));
    if (!role) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Role not found.' } },
        { status: 404 },
      );
    }

    const body = (await request.json()) as UpdateRoleRequest;

    if (role.isSystem && body.name && body.name !== role.name) {
      return HttpResponse.json(
        {
          error: {
            code: 'SYSTEM_ROLE',
            message: 'System roles cannot be renamed.',
          },
        },
        { status: 403 },
      );
    }

    if (body.permissions) {
      // Would this change leave nobody able to manage roles?
      const others = roles.filter((r) => r.id !== role.id);
      const someoneElseCanManage = others.some(
        (r) => r.permissions.includes('roles.manage') && withCounts(r).userCount > 0,
      );
      const thisOneStillCan = body.permissions.includes('roles.manage');

      if (!thisOneStillCan && !someoneElseCanManage) {
        return HttpResponse.json(
          {
            error: {
              code: 'LAST_ADMIN',
              message:
                'At least one role in use must keep "Manage roles", or nobody could change permissions again.',
            },
          },
          { status: 409 },
        );
      }
      role.permissions = body.permissions;
    }

    if (body.name && !role.isSystem) role.name = body.name;
    if (body.description !== undefined) role.description = body.description;

    const responseBody: Single<Role> = { data: withCounts(role) };
    return HttpResponse.json(responseBody);
  }),

  http.delete(EP_PATTERNS.roleDetail, async ({ params }) => {
    await delay(300);
    const index = roles.findIndex((r) => r.id === String(params.id));
    if (index === -1) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Role not found.' } },
        { status: 404 },
      );
    }

    const role = roles[index];
    if (role.isSystem) {
      return HttpResponse.json(
        { error: { code: 'SYSTEM_ROLE', message: 'System roles cannot be deleted.' } },
        { status: 403 },
      );
    }

    const inUse = users.filter((u) => u.roleId === role.id).length;
    if (inUse > 0) {
      return HttpResponse.json(
        {
          error: {
            code: 'ROLE_IN_USE',
            message: `${inUse} account${inUse === 1 ? '' : 's'} still use this role. Move them first.`,
          },
        },
        { status: 409 },
      );
    }

    roles.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
