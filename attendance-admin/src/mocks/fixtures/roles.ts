/**
 * src/mocks/fixtures/roles.ts
 *
 * Roles live in a mutable array, not a frozen constant, because the roles
 * matrix screen will edit them and the changes must survive until reload.
 * In Phase 2 this array becomes a database table; nothing else changes.
 */

import type { Role, RoleId } from '@/contracts/types';
import type { Permission } from '@/contracts/permissions';

const id = (s: string) => s as RoleId;

export const roles: Role[] = [
  {
    id: id('role-owner'),
    name: 'Owner',
    description: 'Full access to everything, including roles and user accounts',
    isSystem: true, // cannot be deleted or have permissions removed
    permissions: [
      'employees.view_all',
      'employees.view_own',
      'employees.create',
      'employees.edit',
      'attendance.view_all',
      'attendance.view_own',
      'attendance.punch_manual',
      'tasks.view_all',
      'tasks.view_own',
      'tasks.assign',
      'tasks.create_own',
      'tasks.edit',
      'tasks.complete_own',
      'roles.manage',
      'users.manage',
      'users.change_role',
      'settings.manage',
    ] as Permission[],
    userCount: 1,
  },
  {
    id: id('role-manager'),
    name: 'Manager',
    description: 'Sees the whole team and assigns work, but cannot manage access',
    isSystem: false,
    permissions: [
      'employees.view_all',
      'employees.view_own',
      'attendance.view_all',
      'attendance.view_own',
      'tasks.view_all',
      'tasks.view_own',
      'tasks.assign',
      'tasks.create_own',
      'tasks.edit',
      'tasks.complete_own',
      'users.change_role',
    ] as Permission[],
    userCount: 1,
  },
  {
    id: id('role-employee'),
    name: 'Employee',
    description: 'Own record, own attendance, own tasks',
    isSystem: true,
    permissions: [
      'employees.view_own',
      'attendance.view_own',
      'tasks.view_own',
      'tasks.create_own',
      'tasks.complete_own',
    ] as Permission[],
    userCount: 6,
  },
];

export function findRole(roleId: string): Role | undefined {
  return roles.find((r) => r.id === roleId);
}
