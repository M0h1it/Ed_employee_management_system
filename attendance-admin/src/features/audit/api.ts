/**
 * src/features/audit/api.ts
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type { AuditEntry, AuditListParams, Paginated } from '@/contracts/types';

export function useAuditLog(params: AuditListParams) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () =>
      apiClient.get<Paginated<AuditEntry>>(EP.audit.list, {
        action: params.action,
        entity: params.entity,
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
    // Short, because the point of opening this screen is usually to see
    // something that just happened.
    staleTime: 10_000,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: () =>
      apiClient.get<{ data: { action: string; count: number }[] }>(EP.audit.actions),
    staleTime: 60_000,
  });
}
