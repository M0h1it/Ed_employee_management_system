/**
 * src/features/devices/api.ts
 *
 * Query hooks for kiosk device registration — register, list, revoke.
 * Mirrors src/features/settings/api.ts's shape: thin wrappers around
 * apiClient with a single shared queryKey ['devices'], since the list is
 * small (one row per physical tablet) and never paginated or filtered.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type {
  Device,
  DeviceCreated,
  CreateDeviceRequest,
  DeviceHistoryEntry,
  Single,
} from '@/contracts/types';

export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => apiClient.get<Single<Device[]>>(EP.devices.list),
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDeviceRequest) =>
      apiClient.post<Single<DeviceCreated>>(EP.devices.create, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiClient.post<Single<Device>>(EP.devices.revoke(deviceId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}

/**
 * Brings a REVOKED device back as the same row with a freshly generated
 * code, rather than creating a new one — see reactivate_device in
 * app/api/v1/devices.py for why this is a distinct endpoint from create
 * (register_device always makes a new row; this never does).
 */
export function useReactivateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiClient.post<Single<DeviceCreated>>(EP.devices.reactivate(deviceId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useDeviceHistory(deviceId: string | null) {
  return useQuery({
    queryKey: ['devices', 'history', deviceId],
    queryFn: () => apiClient.get<Single<DeviceHistoryEntry[]>>(EP.devices.history(deviceId!)),
    enabled: Boolean(deviceId), // do not fire until a device is actually being viewed
  });
}