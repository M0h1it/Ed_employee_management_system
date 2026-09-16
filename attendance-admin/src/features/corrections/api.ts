/**
 * src/features/corrections/api.ts
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  Correction,
  CorrectionStatus,
  CreateCorrectionRequest,
  ListParams,
  Paginated,
  Single,
} from '@/contracts/types';

export function useCorrections(params: ListParams & { status?: CorrectionStatus }) {
  return useQuery({
    queryKey: ['corrections', params],
    queryFn: () =>
      apiClient.get<Paginated<Correction>>(EP.corrections.list, {
        status: params.status,
        page: params.page,
        pageSize: params.pageSize,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useRequestCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCorrectionRequest) =>
      apiClient.post<Single<Correction>>(EP.corrections.create, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corrections'] }),
  });
}

export function useDecideCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CorrectionStatus }) =>
      apiClient.patch<Single<Correction>>(EP.corrections.decide(id), { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      // An approved correction changes what the register says about that day.
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
