/**
 * src/features/employees/api.ts
 *
 * Query hooks for the employees feature.
 *
 * THE queryKey IS THE IMPORTANT PART
 * -----------------------------------
 * ['employees', filters] means: cache this result under these exact filters.
 * Change the search text and it is a different key, so a different cache entry
 * and a fresh request. Go back to the old filters and the cached result is
 * returned instantly with no request at all.
 *
 * That is also how invalidation works later: invalidating ['employees'] drops
 * every cached variation of this list in one call, so a newly created employee
 * appears no matter which filter the user had applied.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  Employee,
  EmployeeListParams,
  Paginated,
  Single,
  Department,
  Shift,
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from '@/contracts/types';

/**
 * @param enabled  Set false to skip the request entirely.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * Modals render while closed, so any hook inside them fires on mount. Three
 * components used this list to fill an employee picker, and all three fetched
 * it even when the picker was hidden — which meant an employee opening the
 * tasks board triggered a request for the whole company directory and got a
 * 403 from the server, correctly.
 *
 * The fix is not to widen the permission. It is to stop asking for data the
 * screen does not need. A request that should not happen is a bug even when it
 * succeeds — with an owner signed in it quietly loads a hundred rows nobody
 * looks at.
 */
export function useEmployees(params: EmployeeListParams, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['employees', params],
    queryFn: () =>
      apiClient.get<Paginated<Employee>>(EP.employees.list, {
        search: params.search,
        departmentId: params.departmentId,
        status: params.status,
        page: params.page,
        pageSize: params.pageSize,
      }),
    // Keeps the previous page visible while the next one loads, instead of
    // flashing an empty table on every page change.
    placeholderData: (previous) => previous,
  });
}

export function useEmployee(id: string | null) {
  return useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: () => apiClient.get<Single<Employee>>(EP.employees.detail(id!)),
    enabled: Boolean(id), // do not fire until an id exists
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiClient.get<Single<Department[]>>(EP.org.departments),
    staleTime: Infinity, // reference data, never changes during a session
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEmployeeRequest) =>
      apiClient.post<Single<Employee>>(EP.employees.list, body),
    onSuccess: () => {
      /**
       * Invalidating the ['employees'] key drops EVERY cached variation of the
       * list — every search term, every department filter, every page. So the
       * new person appears no matter what filter the user had applied.
       *
       * Manually patching the cache instead would be faster but would have to
       * work out whether the new row belongs in the current filter and at what
       * sort position. Refetching is boring and always right.
       */
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateEmployeeRequest) =>
      apiClient.patch<Single<Employee>>(EP.employees.detail(id), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ['shifts'],
    queryFn: () => apiClient.get<Single<Shift[]>>(EP.org.shifts),
    staleTime: Infinity,
  });
}
