/**
 * src/features/attendance/api.ts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  AttendanceDay,
  AttendanceListParams,
  PresentEmployee,
  PunchEvent,
  CreatePunchRequest,
  Paginated,
  Single,
} from '@/contracts/types';

export function useAttendanceDays(params: AttendanceListParams) {
  return useQuery({
    queryKey: ['attendance', 'days', params],
    queryFn: () =>
      apiClient.get<Paginated<AttendanceDay>>(EP.attendance.days, {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        employeeId: params.employeeId,
        departmentId: params.departmentId,
        status: params.status,
        hasFlags: params.hasFlags,
        search: params.search,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
  });
}

export function usePresentEmployees() {
  return useQuery({
    queryKey: ['attendance', 'present'],
    queryFn: () => apiClient.get<Single<PresentEmployee[]>>(EP.attendance.present),
    // Who is inside changes minute to minute, so this one refreshes on its own.
    // 30s is frequent enough to feel live and rare enough to be free.
    refetchInterval: 30_000,
  });
}

/** Raw punches behind one row — only fetched when a row is expanded. */
export function usePunches(employeeId: string | null, date: string | null) {
  return useQuery({
    queryKey: ['attendance', 'punches', employeeId, date],
    queryFn: () =>
      apiClient.get<Single<PunchEvent[]>>(EP.attendance.punches, {
        employeeId: employeeId!,
        date: date!,
      }),
    enabled: Boolean(employeeId && date),
  });
}

export function useCreatePunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePunchRequest) =>
      apiClient.post<Single<PunchEvent>>(EP.attendance.punches, body),
    onSuccess: () => {
      // A new punch changes the day rollup AND the present list, so both keys
      // are dropped. Anything derived from punches must be invalidated here.
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
