/**
 * src/features/users/api.ts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  User,
  UserListParams,
  CreateUserRequest,
  ResetPasswordRequest,
  ChangeRoleRequest,
  Role,
  Paginated,
  Single,
} from '@/contracts/types';

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () =>
      apiClient.get<Paginated<User>>(EP.users.list, {
        search: params.search,
        roleId: params.roleId,
        isActive: params.isActive,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) =>
      apiClient.post<Single<User>>(EP.users.list, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      // Creating a login also flips hasLogin on the employee record, so the
      // directory has to be refetched too. Forgetting cross-feature
      // invalidation is the most common cause of "why is it still showing the
      // old value" bugs.
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResetPasswordRequest }) =>
      apiClient.patch<void>(EP.users.password(id), body),
  });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch<Single<User>>(EP.users.status(id), { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/**
 * The roles the signed-in person may hand out — not every role that exists.
 *
 * The server decides this, by comparing each role's permissions against the
 * caller's. Computing it in the browser would mean shipping the rule twice, and
 * the two copies would eventually disagree.
 */
export function useAssignableRoles(enabled = true) {
  return useQuery({
    queryKey: ['roles', 'assignable'],
    queryFn: () => apiClient.get<Single<Role[]>>(`${EP.roles.list}/assignable`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeRoleRequest }) =>
      apiClient.patch<Single<User>>(EP.users.role(id), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      // The directory shows the role too, and the roles screen shows a count
      // of accounts per role. Both go stale on a move.
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

/** The login account attached to one employee, if there is one. */
export function useUserForEmployee(employeeId: string | null) {
  return useQuery({
    queryKey: ['users', 'by-employee', employeeId],
    queryFn: () =>
      apiClient.get<Paginated<User>>(EP.users.list, { employeeId: employeeId! }),
    enabled: Boolean(employeeId),
  });
}
