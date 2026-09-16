/**
 * src/features/leave/api.ts
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  CreateLeaveRequest,
  Holiday,
  Leave,
  LeaveListParams,
  LeaveStatus,
  Paginated,
  Single,
} from '@/contracts/types';

export function useLeaves(params: LeaveListParams) {
  return useQuery({
    queryKey: ['leaves', params],
    queryFn: () =>
      apiClient.get<Paginated<Leave>>(EP.leave.list, {
        employeeId: params.employeeId,
        status: params.status,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useApplyLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeaveRequest) =>
      apiClient.post<Single<Leave>>(EP.leave.create, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      // An approved leave changes what the attendance register says about
      // those days, so its cache has to go too.
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export function useDecideLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeaveStatus }) =>
      apiClient.patch<Single<Leave>>(EP.leave.decide(id), { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: ['holidays', year],
    queryFn: () => apiClient.get<Single<Holiday[]>>(EP.holidays.list, { year }),
    // Holidays change a few times a year at most.
    staleTime: 5 * 60_000,
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; name: string }) =>
      apiClient.post<Single<Holiday>>(EP.holidays.create, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      // A holiday reclassifies that day for everybody.
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(EP.holidays.remove(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
