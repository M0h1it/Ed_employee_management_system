/**
 * src/mocks/fixtures/users.ts
 *
 * Login accounts.
 *
 * Passwords are stored in plain text HERE ONLY because this is a mock running
 * entirely in your browser. The real backend stores a bcrypt or argon2 hash and
 * never the password itself — it is never sent back to the client, never logged,
 * and cannot be recovered, only reset.
 */

import type { User, UserId, EmployeeId, RoleId } from '@/contracts/types';

const uid = (s: string) => s as UserId;
const eid = (s: string) => s as EmployeeId;
const rid = (s: string) => s as RoleId;

/** Mock-only: username -> password. Never do this in real code. */
export const mockPasswords: Record<string, string> = {
  owner: 'owner123',
  marcus: 'demo123',
  karan: 'demo123',
};

export const users: User[] = [
  {
    id: uid('user-01'),
    employeeId: eid('emp-01'),
    employeeName: 'Elena Vance',
    employeePhotoUrl: null,
    username: 'owner',
    roleId: rid('role-owner'),
    roleName: 'Owner',
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: '2026-10-24T08:31:00+05:30',
    createdAt: '2021-03-01T10:00:00+05:30',
  },
  {
    id: uid('user-02'),
    employeeId: eid('emp-02'),
    employeeName: 'Marcus Ray',
    employeePhotoUrl: null,
    username: 'marcus',
    roleId: rid('role-manager'),
    roleName: 'Manager',
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: '2026-10-23T18:04:00+05:30',
    createdAt: '2022-06-15T10:00:00+05:30',
  },
  {
    id: uid('user-03'),
    employeeId: eid('emp-03'),
    employeeName: 'Karan Patel',
    employeePhotoUrl: null,
    username: 'karan',
    roleId: rid('role-employee'),
    roleName: 'Employee',
    isActive: true,
    mustChangePassword: true, // admin reset it, forced change at next login
    lastLoginAt: null, // never logged in
    createdAt: '2023-01-09T10:00:00+05:30',
  },
];

export function findUserByUsername(username: string): User | undefined {
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}
