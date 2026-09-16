/**
 * src/features/dashboard/api.ts
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  DashboardStats,
  AttendanceException,
  AttendanceTrendPoint,
  TrendGranularity,
  MyAttendanceToday,
  Single,
} from '@/contracts/types';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => apiClient.get<Single<DashboardStats>>(EP.dashboard.stats),
    // The counters move as people arrive and leave. Refetching on an interval
    // keeps the owner's screen current without a websocket, which is far more
    // machinery than a twelve-person office needs.
    refetchInterval: 60_000,
  });
}

export function useExceptions() {
  return useQuery({
    queryKey: ['dashboard', 'exceptions'],
    queryFn: () => apiClient.get<Single<AttendanceException[]>>(EP.dashboard.exceptions),
    refetchInterval: 60_000,
  });
}

export function useMyToday(employeeId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'my-today', employeeId],
    queryFn: () =>
      apiClient.get<Single<MyAttendanceToday>>(EP.dashboard.myToday, { employeeId: employeeId! }),
    enabled: Boolean(employeeId),
    refetchInterval: 60_000,
  });
}

export function useAttendanceTrend(granularity: TrendGranularity) {
  return useQuery({
    queryKey: ['dashboard', 'trend', granularity],
    queryFn: () =>
      apiClient.get<Single<AttendanceTrendPoint[]>>(EP.dashboard.trend, { granularity }),
    // Keeps the previous view on screen while the next granularity loads,
    // instead of collapsing the chart to blank on every toggle.
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
}
