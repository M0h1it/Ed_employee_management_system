/**
 * src/features/settings/api.ts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  OrgSettings,
  UpdateProfileRequest,
  ChangePasswordRequest,
  Employee,
  Department,
  Single,
} from '@/contracts/types';

export function useOrgSettings() {
  return useQuery({
    queryKey: ['org-settings'],
    queryFn: () => apiClient.get<Single<OrgSettings>>(EP.org.settings),
  });
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrgSettings>) =>
      apiClient.patch<Single<OrgSettings>>(EP.org.settings, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-settings'] });
      /**
       * Attendance days are DERIVED from punches using these rules, so changing
       * the grace period or shift times changes every past day too. Dropping
       * the attendance cache makes that visible immediately rather than leaving
       * stale figures on screen until the next navigation.
       */
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      apiClient.patch<Single<Employee>>(EP.auth.profile, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) =>
      apiClient.patch<void>(EP.auth.changePassword, body),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiClient.get<Single<Department[]>>(EP.org.departments),
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiClient.post<Single<Department>>(EP.org.departments, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      // Every screen with a department filter/dropdown (the employee list,
      // this same OrgPanel's own department table) reads from this same
      // cache key — see EmployeeListPage.tsx and OrgPanel — so a newly
      // created department appears everywhere without a page refresh.
    },
  });
}