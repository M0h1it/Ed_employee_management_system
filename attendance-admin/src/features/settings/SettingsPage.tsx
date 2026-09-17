/**
 * src/features/settings/SettingsPage.tsx
 *
 * Own profile, own password, and — for those who may — company policy.
 *
 * WHY THE ORGANISATION TAB IS HIDDEN RATHER THAN DISABLED
 * --------------------------------------------------------
 * A greyed-out tab tells an employee that a setting exists and that they are
 * not trusted with it, which invites a question their manager then has to
 * answer. Absence asks nothing.
 */

import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import PageHeader from '@/components/common/PageHeader';
import Button from '@/components/common/Button';
import Chip from '@/components/common/Chip';
import FormField, { inputCls } from '@/components/common/FormField';
import HolidayPanel from '@/features/leave/HolidayPanel';
import DevicesPanel from '@/features/devices/DevicesPanel';
import PhotoUpload from '@/components/common/PhotoUpload';
import Modal from '@/components/common/Modal';
import { getAccessToken } from '@/lib/apiClient';
import { useOrgSettings, useUpdateOrgSettings, useShiftPolicyHistory, useUpdateProfile, useChangePassword, useDepartments, useCreateDepartment } from './api';
import { useAuthStore } from '@/stores/authStore';
import { useCan } from '@/lib/rbac';
import { ApiException } from '@/lib/apiClient';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import type { ShiftPolicyVersion } from '@/contracts/types';

const TAB_TRIGGER =
  'px-space-base py-space-sm text-left font-label-md text-label-md text-zinc-500 rounded-xl data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900 hover:bg-zinc-50';

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === 'ok'
          ? 'mb-space-base rounded-xl bg-emerald-50 px-space-md py-space-sm font-body-sm text-body-sm text-emerald-600'
          : 'mb-space-base rounded-xl bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-600'
      }
    >
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManageSettings = useCan('settings.manage');
  const canManageHolidays = useCan('holidays.manage');
  const canManageDevices = useCan('devices.manage');

  return (
    <>
      <PageHeader title="Settings & Profile" description="Your account and, if you manage it, company policy" />

      <Tabs.Root defaultValue="profile" className="flex flex-col gap-space-lg lg:flex-row">
        <Tabs.List className="-mx-space-base flex shrink-0 flex-row gap-space-xxs overflow-x-auto px-space-base lg:mx-0 lg:w-[200px] lg:flex-col lg:overflow-visible lg:px-0">
          <Tabs.Trigger value="profile" className={TAB_TRIGGER}>
            Profile
          </Tabs.Trigger>
          <Tabs.Trigger value="password" className={TAB_TRIGGER}>
            Password
          </Tabs.Trigger>
          {canManageHolidays && (
            <Tabs.Trigger value="holidays" className={TAB_TRIGGER}>
              Holidays
            </Tabs.Trigger>
          )}
          {canManageDevices && (
            <Tabs.Trigger value="devices" className={TAB_TRIGGER}>
              Kiosk devices
            </Tabs.Trigger>
          )}
          {canManageSettings && (
            <Tabs.Trigger value="org" className={TAB_TRIGGER}>
              Organisation
            </Tabs.Trigger>
          )}
        </Tabs.List>

        <div className="min-w-0 flex-1">
          <Tabs.Content value="profile">
            <ProfilePanel />
          </Tabs.Content>
          <Tabs.Content value="password">
            <PasswordPanel />
          </Tabs.Content>
          {/* Hidden, not disabled, for anyone without the permission. A
              greyed-out tab advertises a control they cannot use and invites
              a question nobody can answer usefully. */}
          {canManageHolidays && (
            <Tabs.Content value="holidays">
              <HolidayPanel />
            </Tabs.Content>
          )}
          {canManageDevices && (
            <Tabs.Content value="devices">
              <DevicesPanel />
            </Tabs.Content>
          )}
          {canManageSettings && (
            <Tabs.Content value="org">
              <OrgPanel />
              <DepartmentsPanel />
            </Tabs.Content>
          )}
        </div>
      </Tabs.Root>
    </>
  );

  function ProfilePanel() {
  const setSession = useAuthStore((state) => state.setSession);
    const toast = useToast();
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [saved, setSaved] = useState(false);
    const updateProfile = useUpdateProfile();

    useEffect(() => {
      setEmail(user?.email ?? '');
    }, []);

    const fields =
      updateProfile.error instanceof ApiException ? (updateProfile.error.fields ?? {}) : {};

    return (
      <div className="rounded-2xl bg-card p-space-lg">
        {saved && <Banner tone="ok">Profile updated.</Banner>}

        <div className="flex flex-col gap-space-lg md:flex-row">
          <div className="flex flex-col gap-space-sm">
            <PhotoUpload
              employeeId={user?.employeeId ?? ''}
              name={user?.name ?? ''}
              photoUrl={user?.photoUrl ?? null}
              onChange={(photoUrl) => {
                // The session carries the photo — the sidebar avatar and the
                // top bar read it from there — so the store is updated rather
                // than waiting for a refetch that would leave them stale.
                if (user) {
                  setSession({ ...user, photoUrl }, getAccessToken() ?? '');
                }
              }}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-space-base">
            <div className="grid gap-space-base sm:grid-cols-2">
              <FormField label="Full name">
                <input value={user?.name ?? ''} disabled className={`${inputCls()} opacity-60`} />
                <span className="font-label-sm text-label-sm text-zinc-400">
                  Managed by your administrator
                </span>
              </FormField>
              <FormField label="Employee code">
                <input
                  value={user?.username ?? ''}
                  disabled
                  className={`${inputCls()} font-mono-data opacity-60`}
                />
              </FormField>
            </div>

            <div className="grid gap-space-base sm:grid-cols-2">
              <FormField label="Email" error={fields.email}>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls(!!fields.email)}
                />
              </FormField>
              <FormField label="Phone" error={fields.phone}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9810012345"
                  maxLength={10}
                  className={inputCls(!!fields.phone)}
                />
              </FormField>
            </div>

            <div className="grid gap-space-base sm:grid-cols-2">
              <FormField label="Department">
                <input
                  value={user?.departmentName ?? ''}
                  disabled
                  className={`${inputCls()} opacity-60`}
                />
              </FormField>
              <FormField label="Role">
                <div className="flex h-9 items-center">
                  <Chip>{user?.roleName}</Chip>
                </div>
              </FormField>
            </div>

            <div className="flex justify-end">
              <Button
                disabled={updateProfile.isPending}
                onClick={() => {
                  setSaved(false);
                  updateProfile.mutate(
                    { email, phone: phone || undefined },
                    {
                      onSuccess: () => {
                        setSaved(true);
                        toast('Profile updated');
                      },
                    },
                  );
                }}
              >
                {updateProfile.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function PasswordPanel() {
    const toast = useToast();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [done, setDone] = useState(false);
    const changePassword = useChangePassword();

    const fields =
      changePassword.error instanceof ApiException ? (changePassword.error.fields ?? {}) : {};
    const mismatch = confirm.length > 0 && next !== confirm;

    return (
      <div className="max-w-[480px] rounded-2xl bg-card p-space-lg">
        {done && <Banner tone="ok">Password changed. Use it the next time you sign in.</Banner>}

        <div className="flex flex-col gap-space-base">
          {/* Unlike an admin reset, this REQUIRES the current password. Without
              it, anyone finding an unlocked laptop could lock the owner out. */}
          <FormField label="Current password" error={fields.currentPassword} required>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputCls(!!fields.currentPassword)}
            />
          </FormField>

          <FormField label="New password" error={fields.newPassword} required>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputCls(!!fields.newPassword)}
            />
            <span className="font-label-sm text-label-sm text-zinc-400">
              At least 8 characters
            </span>
          </FormField>

          <FormField
            label="Confirm new password"
            error={mismatch ? 'The two passwords do not match' : undefined}
            required
          >
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls(mismatch)}
            />
          </FormField>

          <div className="flex justify-end">
            <Button
              disabled={!current || !next || mismatch || changePassword.isPending}
              onClick={() => {
                setDone(false);
                changePassword.mutate(
                  { currentPassword: current, newPassword: next },
                  {
                    onSuccess: () => {
                      setDone(true);
                      setCurrent('');
                      setNext('');
                      setConfirm('');
                      toast('Password changed');
                    },
                  },
                );
              }}
            >
              {changePassword.isPending ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Shift end, computed from start + minHours — never typed in directly.
   * Handles a fractional hour count (8.5 -> 30 minutes) by working in whole
   * minutes throughout rather than adding a float hour to a Date, which
   * would accumulate rounding error over repeated saves.
   */
  function computeShiftEnd(start: string, hours: number): string {
    const [h, m] = start.split(':').map(Number);
    const totalMinutes = h * 60 + m + Math.round(hours * 60);
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }

  function OrgPanel() {
    const { data, isLoading } = useOrgSettings();
    const { data: history } = useShiftPolicyHistory();
    const update = useUpdateOrgSettings();
    const confirm = useConfirm();
    const toast = useToast();

    const todayIso = new Date().toISOString().slice(0, 10);

    const [start, setStart] = useState('09:00');
    const [grace, setGrace] = useState(15);
    const [minHours, setMinHours] = useState(8);
    const [effectiveFrom, setEffectiveFrom] = useState(todayIso);
    const [saved, setSaved] = useState(false);
    const [viewingVersion, setViewingVersion] = useState<ShiftPolicyVersion | null>(null);

    // Derived, not stored — the end time is always start + minHours, so
    // there is no separate "end" state to keep in sync with the other two
    // and no way for it to silently drift from what those actually imply.
    const end = computeShiftEnd(start, minHours);

    useEffect(() => {
      if (!data) return;
      setStart(data.data.shiftStart);
      setGrace(data.data.graceMinutes);
      setMinHours(data.data.minHours);
      // shiftEnd from the server is intentionally NOT read back into state
      // here — it is derived from start+minHours on this screen now, and
      // trusting the server's stored value instead could disagree with
      // that derivation if the two were ever out of step.
    }, [data]);

    if (isLoading) {
      return <div className="h-64 animate-pulse rounded-2xl bg-card" />;
    }

    return (
      <div className="max-w-[560px] rounded-2xl bg-card p-space-lg">
        {saved && (
          <Banner tone="ok">
            Policy saved, effective from {effectiveFrom}. Days before that date keep using
            whichever policy was already in effect for them.
          </Banner>
        )}

        <p className="mb-space-base font-body-sm text-body-sm text-zinc-500">
          These rules decide who counts as late and which days are flagged. Shift end is set by
          start time plus hours per day, not entered separately. A change here only affects the
          date you choose below onward — days before it keep the policy that was actually in
          effect on them.
        </p>

        <div className="flex flex-col gap-space-base">
          <div className="grid gap-space-base sm:grid-cols-2">
            <FormField label="Shift starts">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputCls()}
              />
            </FormField>
            <FormField label="Shift ends">
              <div className={`${inputCls()} flex items-center bg-zinc-50 text-zinc-500`}>
                {end}
              </div>
              <span className="font-label-sm text-label-sm text-zinc-400">
                Start + hours per day, shown here — not entered directly
              </span>
            </FormField>
          </div>

          <div className="grid gap-space-base sm:grid-cols-2">
            <FormField label="Grace period (minutes)">
              <input
                type="number"
                min={0}
                max={60}
                value={grace}
                onChange={(e) => setGrace(Number(e.target.value))}
                className={inputCls()}
              />
              <span className="font-label-sm text-label-sm text-zinc-400">
                Arriving within this window is not late
              </span>
            </FormField>
            <FormField label="Hours per day">
              <input
                type="number"
                min={1}
                max={12}
                step={0.5}
                value={minHours}
                onChange={(e) => setMinHours(Number(e.target.value))}
                className={inputCls()}
              />
              <span className="font-label-sm text-label-sm text-zinc-400">
                Sets both shift end (start + this) and the short-hours cutoff
              </span>
            </FormField>
          </div>

          <FormField label="Effective from">
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={inputCls()}
            />
            <span className="font-label-sm text-label-sm text-zinc-400">
              When this version of the policy takes effect. Defaults to today; pick an earlier
              date to correct a policy that should have applied sooner, or a future date to
              schedule a change in advance.
            </span>
          </FormField>

          <div className="flex justify-end">
            <Button
              disabled={update.isPending}
              onClick={async () => {
                setSaved(false);
                const ok = await confirm({
                  title: `Save this policy, effective from ${effectiveFrom}?`,
                  description:
                    'This saves a new policy version rather than editing history — days before the effective date keep whichever policy already applied to them. Punch records themselves are never altered.',
                  confirmLabel: 'Save policy',
                });
                if (!ok) return;

                update.mutate(
                  { shiftStart: start, shiftEnd: end, graceMinutes: grace, minHours, effectiveFrom },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      toast(`Policy saved — effective from ${effectiveFrom}`);
                    },
                  },
                );
              }}
            >
              {update.isPending ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        </div>

        {history && history.data.length > 0 && (
          <div className="mt-space-lg border-t border-black/[0.06] pt-space-base">
            <p className="mb-space-sm font-label-md text-label-md text-zinc-500">
              Policy history
            </p>
            <ul className="flex flex-col gap-space-xs">
              {history.data.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center gap-x-space-base gap-y-space-xxs rounded-xl bg-zinc-50 px-space-md py-space-sm font-mono-data text-mono-data text-zinc-600"
                >
                  <span className="font-semibold text-zinc-900">{v.effectiveFrom}</span>
                  <span>
                    {v.shiftStart}–{v.shiftEnd}
                  </span>
                  <span>{v.graceMinutes}m grace</span>
                  <span>{v.minHours}h min</span>
                  <button
                    onClick={() => setViewingVersion(v)}
                    aria-label={`View details for the policy effective from ${v.effectiveFrom}`}
                    className="ml-auto rounded-lg p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                  >
                    <span className="icon text-[16px]">visibility</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Modal
          open={viewingVersion !== null}
          onOpenChange={(open) => !open && setViewingVersion(null)}
          title={viewingVersion ? `Policy effective from ${viewingVersion.effectiveFrom}` : 'Policy version'}
          footer={
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setViewingVersion(null)}>
                Close
              </Button>
            </div>
          }
        >
          {viewingVersion && (
            <div className="grid grid-cols-2 gap-x-space-base gap-y-space-sm">
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Shift starts</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {viewingVersion.shiftStart}
                </p>
              </div>
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Shift ends</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {viewingVersion.shiftEnd}
                </p>
              </div>
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Grace period</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {viewingVersion.graceMinutes} minutes
                </p>
              </div>
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Hours per day</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {viewingVersion.minHours}h
                </p>
              </div>
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Effective from</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {viewingVersion.effectiveFrom}
                </p>
              </div>
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Saved on</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {new Date(viewingVersion.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  function DepartmentsPanel() {
    const { data, isLoading } = useDepartments();
    const create = useCreateDepartment();
    const toast = useToast();
    const [name, setName] = useState('');

    const fields = create.error instanceof ApiException ? (create.error.fields ?? {}) : {};
    const departments = data?.data ?? [];

    function handleAdd() {
      const trimmed = name.trim();
      if (!trimmed) return;
      create.mutate(trimmed, {
        onSuccess: () => {
          setName('');
          toast('Department added');
        },
        onError: (err) => {
          if (!(err instanceof ApiException)) toast('Could not add this department.', 'error');
          // A duplicate-name 422 renders inline via `fields` below instead
          // of a toast — the person is looking right at the input that
          // needs fixing, so a toast would just repeat what the field
          // error already says.
        },
      });
    }

    return (
      <div className="mt-space-lg max-w-[560px] rounded-2xl bg-card p-space-lg">
        <p className="mb-space-base font-body-sm text-body-sm text-zinc-500">
          Departments group employees for filtering and reporting. They can be added here but not
          renamed or removed yet — employees already assigned to one would need to move first.
        </p>

        <div className="mb-space-base flex flex-wrap gap-space-xs">
          {isLoading ? (
            <div className="h-8 w-full animate-pulse rounded-xl bg-zinc-100" />
          ) : departments.length === 0 ? (
            <span className="font-body-sm text-body-sm text-zinc-400">No departments yet.</span>
          ) : (
            departments.map((d) => <Chip key={d.id}>{d.name}</Chip>)
          )}
        </div>

        <div className="flex items-start gap-space-sm">
          <div className="flex-1">
            <FormField label="New department" error={fields.name}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. Finance"
                className={inputCls(!!fields.name)}
              />
            </FormField>
          </div>
          <Button
            icon="add"
            disabled={!name.trim() || create.isPending}
            onClick={handleAdd}
            className="mt-space-lg"
          >
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>
    );
  }
}