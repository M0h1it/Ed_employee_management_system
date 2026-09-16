/**
 * src/features/devices/DevicesPanel.tsx
 *
 * Register, list, revoke, and reactivate kiosk tablets. Lives under
 * Settings, gated by devices.manage — separate from pin.generate and
 * face.enrol, matching the backend's three distinct Kiosk permissions.
 *
 * ONE ROW PER PHYSICAL TABLET, EVEN ACROSS A REVOKE
 * -----------------------------------------------------
 * A revoked device is brought back with "Reactivate", not "Add device" —
 * reactivate_device (app/api/v1/devices.py) flips the SAME row back to
 * active with a freshly generated code, rather than creating a second row.
 * That is why the list never shows two rows for what is really one tablet
 * that was taken out of service and put back: there genuinely is only one
 * row, and its own history (below) shows every past revoke/reactivate.
 *
 * THE CODE REVEAL FOLLOWS PinGenerator's PATTERN
 * ---------------------------------------------------
 * A device code — whether from registering or reactivating — is shown once,
 * in its own modal, the instant the action succeeds. There is no "show code
 * again": the backend never returns the plain value a second time.
 */

import { useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Chip from '@/components/common/Chip';
import FormField, { inputCls } from '@/components/common/FormField';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { ApiException } from '@/lib/apiClient';
import {
  useDevices,
  useCreateDevice,
  useRevokeDevice,
  useReactivateDevice,
  useDeviceHistory,
} from './api';
import type { Device } from '@/contracts/types';
import { formatDateTime } from '@/lib/format';

const HISTORY_LABELS: Record<string, string> = {
  'device.register': 'Registered',
  'device.revoke': 'Revoked',
  'device.reactivate': 'Reactivated',
};

function LastSeen({ value }: { value: string | null }) {
  if (!value) {
    return <span className="font-label-sm text-label-sm text-zinc-400">Never</span>;
  }
  return <span className="font-mono-data text-mono-data text-zinc-500">{formatDateTime(value)}</span>;
}

/** Shown once after ANY action that returns a plain-text code — registering
 * a new device or reactivating a revoked one. Identical either way, because
 * from this point on the two are indistinguishable: a code that works. */
function CodeRevealModal({
  code,
  deviceName,
  onClose,
}: {
  code: string | null;
  deviceName: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={code !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Device code generated"
      description={`Enter this code into "${deviceName}" now. It will not be shown again.`}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="flex items-center justify-center rounded-2xl bg-zinc-900 py-space-lg">
        <span className="font-mono-data text-[28px] tracking-[0.2em] text-white">{code}</span>
      </div>
      <p className="mt-space-sm font-label-sm text-label-sm text-zinc-400">
        If this code is lost before setup finishes, revoke the device and reactivate it again —
        a code cannot be recovered once this window closes.
      </p>
    </Modal>
  );
}

function AddDeviceModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [reveal, setReveal] = useState<{ code: string; name: string } | null>(null);
  const create = useCreateDevice();
  const toast = useToast();

  const fields = create.error instanceof ApiException ? (create.error.fields ?? {}) : {};

  function reset() {
    setName('');
    setLocation('');
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) reset();
        }}
        title="Register a kiosk device"
        description="A code is generated for this device and shown once, on the next screen. Enter it into the tablet's setup screen — it is not stored anywhere the tablet can be recovered from later."
        footer={
          <div className="flex justify-end gap-space-sm">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => {
                create.mutate(
                  { name: name.trim(), location: location.trim() || undefined },
                  {
                    onSuccess: (response) => {
                      setReveal({ code: response.data.deviceCode, name: response.data.device.name });
                      onOpenChange(false);
                      reset();
                    },
                    onError: () => toast('Could not register this device.', 'error'),
                  },
                );
              }}
            >
              {create.isPending ? 'Registering…' : 'Register'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-space-base">
          <FormField label="Name" error={fields.name} required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Front desk tablet"
              className={inputCls(!!fields.name)}
            />
          </FormField>
          <FormField label="Location" error={fields.location}>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Main entrance"
              className={inputCls(!!fields.location)}
            />
            <span className="font-label-sm text-label-sm text-zinc-400">Optional — helps tell tablets apart</span>
          </FormField>
        </div>
      </Modal>

      <CodeRevealModal
        code={reveal?.code ?? null}
        deviceName={reveal?.name ?? ''}
        onClose={() => setReveal(null)}
      />
    </>
  );
}

function HistoryModal({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const { data, isLoading } = useDeviceHistory(device?.id ?? null);
  const entries = data?.data ?? [];

  return (
    <Modal
      open={device !== null}
      onOpenChange={(open) => !open && onClose()}
      title={device ? `History — ${device.name}` : 'History'}
      description="Every registration, revoke, and reactivation for this device, newest first."
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-space-xs">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-space-base text-center font-body-sm text-body-sm text-zinc-400">
          No history recorded yet.
        </p>
      ) : (
        <ol className="divide-y divide-black/[0.06]">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center justify-between gap-space-sm py-space-sm">
              <span className="font-body-sm text-body-sm text-zinc-900">
                {HISTORY_LABELS[e.action] ?? e.action}
                {e.actorName && (
                  <span className="text-zinc-400"> · by {e.actorName}</span>
                )}
              </span>
              <span className="font-mono-data text-mono-data text-zinc-500">
                {formatDateTime(e.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function DeviceRow({
  device,
  onViewHistory,
}: {
  device: Device;
  onViewHistory: (d: Device) => void;
}) {
  const revoke = useRevokeDevice();
  const reactivate = useReactivateDevice();
  const confirm = useConfirm();
  const toast = useToast();
  const [reveal, setReveal] = useState<{ code: string; name: string } | null>(null);

  async function handleRevoke() {
    const ok = await confirm({
      title: `Revoke "${device.name}"?`,
      description:
        'This tablet will stop being able to record punches immediately, including anything queued offline that has not synced yet. You can bring it back later with "Reactivate", which issues a new code.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;

    revoke.mutate(device.id, {
      onSuccess: () => toast('Device revoked'),
      onError: () => toast('Could not revoke this device.', 'error'),
    });
  }

  async function handleReactivate() {
    const ok = await confirm({
      title: `Reactivate "${device.name}"?`,
      description:
        'A new code is generated for this device — enter it into the tablet\'s setup screen. This is the same device record; its past history is kept.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;

    reactivate.mutate(device.id, {
      onSuccess: (response) => {
        setReveal({ code: response.data.deviceCode, name: response.data.device.name });
      },
      onError: () => toast('Could not reactivate this device.', 'error'),
    });
  }

  return (
    <>
      <tr className="border-b border-black/[0.06] last:border-0">
        <td className="py-space-sm">
          <div className="flex flex-col">
            <span className="font-body-sm text-body-sm text-zinc-900">{device.name}</span>
            {device.location && (
              <span className="font-label-sm text-label-sm text-zinc-400">{device.location}</span>
            )}
          </div>
        </td>
        <td className="py-space-sm">
          {device.isActive ? (
            <Chip tone="positive" dot>
              Active
            </Chip>
          ) : (
            <Chip tone="muted" dot>
              Revoked
            </Chip>
          )}
        </td>
        <td className="py-space-sm">
          <LastSeen value={device.lastSeenAt} />
        </td>
        <td className="py-space-sm text-right">
          <div className="flex items-center justify-end gap-space-xs">
            <button
              onClick={() => onViewHistory(device)}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-200"
            >
              <span className="icon text-[13px]">history</span>
              History
            </button>
            {device.isActive ? (
              <button
                onClick={handleRevoke}
                disabled={revoke.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-red-50 hover:text-red-600"
              >
                <span className="icon text-[13px]">block</span>
                Revoke
              </button>
            ) : (
              // Reactivates the SAME row (see reactivate_device in
              // app/api/v1/devices.py) — never creates a second row for
              // this tablet, which is what keeps it to one row in the list.
              <button
                onClick={handleReactivate}
                disabled={reactivate.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <span className="icon text-[13px]">refresh</span>
                {reactivate.isPending ? 'Reactivating…' : 'Reactivate'}
              </button>
            )}
          </div>
        </td>
      </tr>

      <CodeRevealModal
        code={reveal?.code ?? null}
        deviceName={reveal?.name ?? ''}
        onClose={() => setReveal(null)}
      />
    </>
  );
}

export default function DevicesPanel() {
  const { data, isLoading } = useDevices();
  const [addOpen, setAddOpen] = useState(false);
  const [historyDevice, setHistoryDevice] = useState<Device | null>(null);
  const devices = data?.data ?? [];

  return (
    <div className="rounded-2xl bg-card p-space-lg">
      <div className="mb-space-base flex items-center justify-between gap-space-sm">
        <p className="font-body-sm text-body-sm text-zinc-500">
          Each kiosk tablet authenticates with its own code, entered once during setup. Revoking a
          device takes effect immediately — a lost or decommissioned tablet stops working the
          moment it is revoked here, whatever it is mid-way through. A revoked device stays as one
          record; reactivate it to bring the same tablet back with a new code.
        </p>
        <Button icon="add" onClick={() => setAddOpen(true)}>
          Add device
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-space-xs">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <p className="py-space-lg text-center font-body-sm text-body-sm text-zinc-400">
          No kiosk devices registered yet.
        </p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="pb-space-xs font-label-sm text-label-sm font-medium text-zinc-400">Device</th>
              <th className="pb-space-xs font-label-sm text-label-sm font-medium text-zinc-400">Status</th>
              <th className="pb-space-xs font-label-sm text-label-sm font-medium text-zinc-400">Last active</th>
              <th className="pb-space-xs"></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <DeviceRow key={d.id} device={d} onViewHistory={setHistoryDevice} />
            ))}
          </tbody>
        </table>
      )}

      <AddDeviceModal open={addOpen} onOpenChange={setAddOpen} />
      <HistoryModal device={historyDevice} onClose={() => setHistoryDevice(null)} />
    </div>
  );
}