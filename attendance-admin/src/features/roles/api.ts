/**
 * src/features/roles/api.ts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type { Role, CreateRoleRequest, UpdateRoleRequest, Single } from '@/contracts/types';

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<Single<Role[]>>(EP.roles.list),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoleRequest) =>
      apiClient.post<Single<Role>>(EP.roles.list, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleRequest }) =>
      apiClient.patch<Single<Role>>(EP.roles.detail(id), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      // A permission change can alter what the SIGNED-IN user may see. The
      // store is not refreshed here on purpose — see the note in RolesPage.
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(EP.roles.detail(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}
