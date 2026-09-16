/**
 * src/features/auth/api.ts
 *
 * Every query and mutation for the auth feature.
 *
 * RULE FOR THE WHOLE PROJECT: components never call apiClient or fetch
 * directly. They call a hook from a file like this one. That keeps caching,
 * error handling and cache invalidation in one place per feature instead of
 * scattered through the components.
 */

import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type { LoginRequest, LoginResponse } from '@/contracts/types';
import { useAuthStore } from '@/stores/authStore';
import { queryClient } from '@/lib/queryClient';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (credentials: LoginRequest) =>
      apiClient.post<LoginResponse>(EP.auth.login, credentials),

    onSuccess: (data) => {
      setSession(data.user, data.accessToken);
      navigate('/dashboard', { replace: true });
    },
    // No onError here: the component reads `mutation.error` and renders it.
    // Handling errors in the component keeps the message next to the form it
    // belongs to.
  });
}

export function useLogout() {
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => apiClient.post<void>(EP.auth.logout),
    onSettled: () => {
      // Runs whether the request succeeded or failed — a failed logout request
      // must still log the user out locally.
      clearSession('manual');
      queryClient.clear(); // drop every cached query so the next user sees nothing
      navigate('/login', { replace: true });
    },
  });
}
