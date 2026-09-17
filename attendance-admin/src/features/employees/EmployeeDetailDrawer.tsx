/**
 * src/features/employees/EmployeeDetailDrawer.tsx
 *
 * Everything about one person, without leaving the list.
 *
 * WHY A DRAWER AND NOT A SEPARATE PAGE: the common action here is scanning
 * several people in a row. A page navigation loses the list's scroll position,
 * its filters and its page number every time. A drawer keeps the list behind it
 * intact, so closing it returns you exactly where you were.
 *
 * The Attendance tab reuses useAttendanceDays — the same hook the register
 * uses, with an employeeId filter. That reuse is the payoff of putting query
 * hooks in feature-level api.ts files rather than inside page components.
 */

import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { format, subDays } from 'date-fns';
import Drawer from '@/components/common/Drawer';
import PhotoUpload from '@/components/common/PhotoUpload';
import FaceEnrolment from './FaceEnrolment';
import PinGenerator from './PinGenerator';
import { useQueryClient } from '@tanstack/react-query';
import Chip from '@/components/common/Chip';
import Button from '@/components/common/Button';
import PermissionGate from '@/components/common/PermissionGate';
import { useAttendanceDays } from '@/features/attendance/api';
import { useTasks } from '@/features/tasks/api';
import { useUserForEmployee } from '@/features/users/api';
import ChangeRoleModal from '@/features/users/ChangeRoleModal';
import { useCan } from '@/lib/rbac';
import type { User } from '@/contracts/types';
import { formatDate, formatTime, formatDuration } from '@/lib/format';
import { FLAG_LABELS } from '@/domain/attendanceRules';
import type { Employee } from '@/contracts/types';

interface Props {
  employee: Employee | null;
  onClose: () => void;
  onEdit: (employee: Employee) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-space-base py-space-sm">
      <span className="font-label-md text-label-md text-zinc-500">{label}</span>
      <span className="text-right font-body-sm text-body-sm text-zinc-900">{value}</span>
    </div>
  );
}

const TAB_TRIGGER =
  'px-space-base py-space-sm font-label-md text-label-md text-zinc-500 border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-zinc-900';

export default function EmployeeDetailDrawer({ employee, onClose, onEdit }: Props) {
  const [tab, setTab] = useState('details');
  const [changingRole, setChangingRole] = useState<User | null>(null);

  /**
   * A manager can change an employee's role but cannot open Access Control —
   * that screen needs `users.manage`, which manages passwords and account
   * status too. So the role control lives here, next to the person it is about.
   */
  const canChangeRole = useCan('users.change_role');
  const canEdit = useCan('employees.edit');
  const canEnrolFace = useCan('face.enrol');
  const canGeneratePin = useCan('pin.generate');
  const queryClient = useQueryClient();
  const { data: userData } = useUserForEmployee(
    canChangeRole && employee?.hasLogin ? employee.id : null,
  );
  const loginAccount = userData?.data[0] ?? null;

  const dateTo = format(new Date(), 'yyyy-MM-dd');
  const dateFrom = format(subDays(new Date(), 13), 'yyyy-MM-dd');

  const { data: taskData, isLoading: tasksLoading } = useTasks({
    employeeId: (employee?.id ?? undefined) as any,
    pageSize: 50,
  });

  const { data: attendance, isLoading: attendanceLoading } = useAttendanceDays({
    dateFrom,
    dateTo,
    employeeId: (employee?.id ?? undefined) as any,
    pageSize: 30,
  });

  if (!employee) return null;

  const days = (attendance?.data ?? []).filter((d) => d.status !== 'WEEKEND');
  const presentDays = days.filter((d) => d.status === 'PRESENT').length;
  const lateDays = days.filter((d) => d.flags.includes('LATE_IN')).length;
  const totalMinutes = days.reduce((sum, d) => sum + d.workedMinutes, 0);

  return (
    <Drawer
      open={Boolean(employee)}
      onOpenChange={(open) => !open && onClose()}
      title={employee.name}
      subtitle={`${employee.position} · ${employee.departmentName}`}
      header={
        <div className="mb-space-sm flex flex-wrap items-center gap-space-md">
          {/* Editable only with employees.edit. Everyone else sees the same
              avatar with no controls, rather than a disabled button that
              advertises something they cannot do. */}
          <PhotoUpload
            employeeId={employee.id}
            name={employee.name}
            photoUrl={employee.photoUrl}
            editable={canEdit}
            onChange={() => {
              // The photo lives on the employee record, which the list and the
              // drawer both read, so both caches are dropped rather than
              // patched — a patch would have to know every shape it appears in.
              queryClient.invalidateQueries({ queryKey: ['employees'] });
              queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
            }}
          />
          <div className="flex flex-wrap gap-space-xs">
            {employee.status === 'active' ? (
              <Chip tone="positive" dot>
                Active
              </Chip>
            ) : (
              <Chip tone="muted" dot>
                Inactive
              </Chip>
            )}
            {employee.faceEnrolled ? (
              <Chip tone="neutral">Face enrolled</Chip>
            ) : (
              <Chip tone="warning">No face on file</Chip>
            )}
          </div>
        </div>
      }
    >
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex overflow-x-auto border-b border-black/[0.06] px-space-base sm:px-space-lg">
          <Tabs.Trigger value="details" className={TAB_TRIGGER}>
            Details
          </Tabs.Trigger>
          <Tabs.Trigger value="attendance" className={TAB_TRIGGER}>
            Attendance
          </Tabs.Trigger>
          <Tabs.Trigger value="tasks" className={TAB_TRIGGER}>
            Tasks
          </Tabs.Trigger>
        </Tabs.List>

        {/* --- Details ---------------------------------------------------- */}
        <Tabs.Content value="details" className="px-space-base py-space-base sm:px-space-lg">
          <div className="divide-y divide-black/[0.06]">
            <Field label="Employee code" value={<span className="font-mono-data">{employee.empCode}</span>} />
            <Field label="Email" value={employee.email} />
            <Field label="Phone" value={<span className="font-mono-data">{employee.phone}</span>} />
            <Field label="Department" value={employee.departmentName} />
            <Field label="Position" value={employee.position} />
            <Field label="Joined" value={formatDate(employee.joinDate)} />
            <Field
              label="Login account"
              value={
                employee.hasLogin ? (
                  <div className="flex items-center justify-end gap-space-xs">
                    <Chip>{employee.roleName}</Chip>
                    {canChangeRole && loginAccount && (
                      <button
                        onClick={() => setChangingRole(loginAccount)}
                        className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <span className="icon text-[13px]">swap_horiz</span>
                        Change
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-zinc-400">Not created</span>
                )
              }
            />
          </div>

          {/* Face enrolment and the PIN only make sense for someone whose
              attendance is actually tracked — an Owner (or anyone else
              with attendanceTracked=false) sets their own schedule and has
              no kiosk check-in flow to enrol into, so these modules do not
              show on their own profile even for a viewer with every
              permission this section would otherwise gate on. */}
          {canEnrolFace && employee.attendanceTracked && (
            <div className="mt-space-lg">
              <FaceEnrolment
                employeeId={employee.id}
                enrolled={employee.faceEnrolled}
                editable={canEnrolFace}
                onEnrolled={() => {
                  // faceEnrolled and the template count both live server-side
                  // only — there is nothing to patch optimistically, so both
                  // caches that show this employee are dropped and refetched,
                  // same approach PhotoUpload's onChange takes above.
                  queryClient.invalidateQueries({ queryKey: ['employees'] });
                  queryClient.invalidateQueries({ queryKey: ['employees', 'detail', employee.id] });
                }}
              />
            </div>
          )}

          {/* pin_hash lives on the login account, not the employee record —
              a PIN has nothing to attach to without one, so this only shows
              once loginAccount has actually resolved (the same data the
              "Change role" control above already depends on). */}
          {canGeneratePin && employee.attendanceTracked && employee.hasLogin && loginAccount && (
            <div className="mt-space-sm">
              <PinGenerator
                userId={loginAccount.id}
                employeeName={employee.name}
                hasPinSet={loginAccount.hasPinSet}
                editable={canGeneratePin}
              />
            </div>
          )}

          <PermissionGate need="employees.edit">
            <div className="mt-space-lg flex gap-space-sm">
              <Button icon="edit" onClick={() => onEdit(employee)}>
                Edit details
              </Button>
            </div>
          </PermissionGate>
        </Tabs.Content>

        {/* --- Attendance ------------------------------------------------- */}
        <Tabs.Content value="attendance" className="px-space-base py-space-base sm:px-space-lg">
          <div className="mb-space-base grid grid-cols-3 gap-space-xs sm:gap-space-sm">
            {[
              { label: 'Days present', value: presentDays },
              { label: 'Late arrivals', value: lateDays },
              { label: 'Total hours', value: formatDuration(totalMinutes) },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-2xl bg-zinc-50 px-space-md py-space-sm"
              >
                <p className="font-headline-md text-headline-md text-zinc-900">{s.value}</p>
                <p className="font-label-sm text-label-sm text-zinc-400">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="mb-space-sm font-label-sm text-label-sm uppercase tracking-wider text-zinc-400">
            Last 14 days
          </p>

          {attendanceLoading ? (
            <div className="flex flex-col gap-space-xs">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-xl bg-zinc-100" />
              ))}
            </div>
          ) : (
            <ol className="divide-y divide-black/[0.06] overflow-x-auto">
              {days.map((d) => (
                <li
                  key={d.date}
                  className="flex min-w-[380px] items-center gap-space-sm py-space-sm sm:gap-space-md"
                >
                  <span className="w-24 font-mono-data text-mono-data text-zinc-500">
                    {format(new Date(d.date), 'dd MMM')}
                  </span>
                  <span className="w-20 font-mono-data text-mono-data text-zinc-900">
                    {formatTime(d.firstIn)}
                  </span>
                  <span className="w-20 font-mono-data text-mono-data text-zinc-900">
                    {formatTime(d.lastOut)}
                  </span>
                  <span className="w-16 font-mono-data text-mono-data text-zinc-400">
                    {formatDuration(d.workedMinutes)}
                  </span>
                  <div className="ml-auto flex gap-space-xs">
                    {d.status === 'ABSENT' ? (
                      <Chip tone="danger">Absent</Chip>
                    ) : (
                      d.flags.map((f) => (
                        <Chip key={f} tone="warning">
                          {FLAG_LABELS[f]}
                        </Chip>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Tabs.Content>
        {/* --- Tasks ------------------------------------------------------ */}
        <Tabs.Content value="tasks" className="px-space-base py-space-base sm:px-space-lg">
          {tasksLoading ? (
            <div className="flex flex-col gap-space-xs">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100" />
              ))}
            </div>
          ) : (taskData?.data.length ?? 0) === 0 ? (
            <p className="py-space-lg text-center font-body-sm text-body-sm text-zinc-400">
              No tasks assigned.
            </p>
          ) : (
            <ol className="divide-y divide-black/[0.06]">
              {taskData!.data.map((t) => (
                <li key={t.id} className="flex items-start gap-space-md py-space-sm">
                  <span
                    className={
                      t.status === 'done'
                        ? 'icon mt-0.5 text-[16px] text-emerald-600'
                        : 'icon mt-0.5 text-[16px] text-zinc-400'
                    }
                  >
                    {t.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={
                        t.status === 'done'
                          ? 'font-body-sm text-body-sm text-zinc-500 line-through'
                          : 'font-body-sm text-body-sm text-zinc-900'
                      }
                    >
                      {t.title}
                    </span>
                    {t.dueDate && (
                      <span
                        className={
                          t.isOverdue
                            ? 'font-mono-data text-mono-data text-red-600'
                            : 'font-mono-data text-mono-data text-zinc-400'
                        }
                      >
                        Due {format(new Date(t.dueDate), 'dd MMM')}
                      </span>
                    )}
                  </div>
                  {t.priority === 'high' && <Chip tone="danger">High</Chip>}
                </li>
              ))}
            </ol>
          )}
        </Tabs.Content>
      </Tabs.Root>

      <ChangeRoleModal user={changingRole} onClose={() => setChangingRole(null)} />
    </Drawer>
  );
}