/**
 * src/lib/queryClient.ts
 *
 * TanStack Query configuration, in one place.
 *
 * staleTime 30s: a fetched result is considered fresh for 30 seconds, so
 * navigating away and back does not refire the request. Attendance data moves
 * slowly enough that 30s is invisible to the user and saves a lot of traffic.
 *
 * retry 1: one automatic retry on failure. More than that just delays showing
 * the user a real error.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiException } from './apiClient';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry a 4xx — the request itself is wrong, repeating it will
        // not help. Only retry server or network failures, and only once.
        if (error instanceof ApiException && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});
