/**
 * src/features/tasks/api.ts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  Task,
  TaskListParams,
  CreateTaskRequest,
  UpdateTaskRequest,
  Paginated,
  Single,
  TimelineParams,
  TimelineRow,
} from '@/contracts/types';

export function useTasks(params: TaskListParams) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () =>
      apiClient.get<Paginated<Task>>(EP.tasks.list, {
        employeeId: params.employeeId,
        status: params.status,
        priority: params.priority,
        search: params.search,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) =>
      apiClient.post<Single<Task>>(EP.tasks.list, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskRequest }) =>
      apiClient.patch<Single<Task>>(EP.tasks.detail(id), body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<Single<Task>>(EP.tasks.complete(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

/**
 * The task timeline, grouped by person.
 *
 * NOW ON THE REAL ENDPOINT. This read local fixtures while the chart was being
 * designed; the swap was this function body and nothing else. The chart, the
 * filters and the table were written against the contract type and never knew
 * which side was answering — the same arrangement that made the Phase 1 to
 * Phase 2 cutover a single flag.
 */
export function useTaskTimeline(params: TimelineParams) {
  return useQuery({
    queryKey: ['tasks', 'timeline', params],
    queryFn: () =>
      apiClient.get<Single<TimelineRow[]>>(EP.tasks.timeline, {
        range: params.range,
        employeeId: params.employeeId,
        status: params.status,
      }),
    // Keeps the previous chart on screen while a wider range loads, rather
    // than collapsing it to a skeleton on every toggle.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}
