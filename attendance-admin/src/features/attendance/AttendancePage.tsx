/**
 * src/features/attendance/AttendancePage.tsx
 *
 * The attendance register — today by default, any date range on demand.
 *
 * WHAT MAKES THIS SCREEN THE HEART OF THE SYSTEM: everything on it is derived
 * from punch events. No row here is stored anywhere. Expand a row and you see
 * the raw events it was computed from. That is the property that makes the
 * data defensible when somebody disputes it.
 */

import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import SearchInput from '@/components/common/SearchInput';
import Select from '@/components/common/Select';
import Avatar from '@/components/common/Avatar';
import Chip from '@/components/common/Chip';
import Button from '@/components/common/Button';
import EmptyState from '@/components/common/EmptyState';
import PermissionGate from '@/components/common/PermissionGate';
import PunchList from './PunchList';
import CorrectionForm from '@/features/corrections/CorrectionForm';
import ManualPunchModal from './ManualPunchModal';
import { getAccessToken } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import { useToast } from '@/components/common/Toast';
import { useAttendanceDays } from './api';
import { useDepartments } from '@/features/employees/api';
import { formatTime, formatDate, formatDuration } from '@/lib/format';
import { FLAG_LABELS } from '@/domain/attendanceRules';
import { useAuthStore } from '@/stores/authStore';
import type { AttendanceDay, AttendanceStatus } from '@/contracts/types';

const PAGE_SIZE = 15;
const today = () => format(new Date(), 'yyyy-MM-dd');

const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

export default function AttendancePage() {
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [correcting, setCorrecting] = useState<AttendanceDay | null>(null);

  const user = useAuthStore((s) => s.user);
  const canViewAll = useAuthStore((s) => s.permissions.has('attendance.view_all'));

  const range = searchParams.get('range') ?? 'today';
  const search = searchParams.get('search') ?? '';
  const departmentId = searchParams.get('departmentId') ?? '';
  const status = searchParams.get('status') ?? '';
  const onlyFlags = searchParams.get('flags') === 'true';
  const page = Number(searchParams.get('page') ?? 1);

  const dateTo = today();
  const dateFrom =
    range === 'today' ? dateTo : format(subDays(new Date(), Number(range) - 1), 'yyyy-MM-dd');

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useAttendanceDays({
    dateFrom,
    dateTo,
    // An employee without view_all only ever sees their own rows. The server
    // enforces this too — this is just so the request is honest about intent.
    employeeId: canViewAll ? undefined : (user?.employeeId as any),
    departmentId: departmentId || undefined,
    status: (status || undefined) as AttendanceStatus | undefined,
    hasFlags: onlyFlags || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const { data: deptData } = useDepartments();
  const rows = data?.data ?? [];

  const summary = rows.reduce(
    (acc, r) => {
      if (r.status === 'PRESENT') acc.present++;
      if (r.status === 'ABSENT') acc.absent++;
      if (r.flags.includes('LATE_IN')) acc.late++;
      if (r.flags.includes('MISSING_OUT')) acc.missing++;
      return acc;
    },
    { present: 0, absent: 0, late: 0, missing: 0 },
  );

  function rowKey(r: AttendanceDay) {
    return `${r.employeeId}:${r.date}`;
  }

  /**
   * Downloads the CSV.
   *
   * WHY fetch AND NOT A PLAIN <a href>
   * -----------------------------------
   * The endpoint needs an Authorization header, and a link cannot carry one.
   * So the file is fetched, turned into a blob, and handed to a temporary
   * anchor — which is also what lets the filename come from the server rather
   * than from a guess in the browser.
   */
  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (departmentId) params.set('departmentId', departmentId);

      const response = await fetch(`${EP.org.exportAttendance}?${params}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!response.ok) throw new Error('export failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance-${dateFrom}-to-${dateTo}.csv`;
      link.click();
      // Released immediately; the download has already been handed to the
      // browser and holding the object URL leaks the blob for the session.
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not export. Try a shorter date range.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          range === 'today'
            ? `Register for ${formatDate(dateTo)}`
            : `${formatDate(dateFrom)} to ${formatDate(dateTo)}`
        }
        actions={
          <>
            <PermissionGate need="attendance.view_all">
              <Button
                variant="secondary"
                icon="download"
                onClick={exportCsv}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            </PermissionGate>
            <PermissionGate need="attendance.punch_manual">
              <Button icon="add" onClick={() => setManualOpen(true)}>
                Manual punch
              </Button>
            </PermissionGate>
          </>
        }
      />

      {/* Summary strip. Counts describe the CURRENT PAGE of results, which is
          why it says so — a number whose scope is ambiguous is worse than no
          number at all. */}
      <div className="mb-space-base flex flex-wrap items-center gap-space-lg rounded-2xl bg-card px-space-base py-space-md">
        {[
          { label: 'Present', value: summary.present, tone: 'positive' as const },
          { label: 'Late', value: summary.late, tone: 'warning' as const },
          { label: 'Absent', value: summary.absent, tone: 'danger' as const },
          { label: 'Missing out', value: summary.missing, tone: 'muted' as const },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-space-sm">
            <span className="font-headline-lg text-headline-lg text-zinc-900">
              {s.value}
            </span>
            <Chip tone={s.tone}>{s.label}</Chip>
          </div>
        ))}
        <span className="w-full font-label-sm text-label-sm text-zinc-400 sm:ml-auto sm:w-auto">
          on this page
        </span>
      </div>

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full sm:w-[150px]">
          <Select
            aria-label="Date range"
            value={range === 'today' ? 'today' : range}
            onChange={(v) => setFilter('range', v)}
            options={RANGE_PRESETS}
            placeholder="Today"
          />
        </div>
        {canViewAll && (
          <>
            <div className="w-full min-w-[200px] sm:flex-1">
              <SearchInput
                value={search}
                onChange={(v) => setFilter('search', v)}
                placeholder="Search by name…"
              />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-[180px]">
              <Select
                aria-label="Department"
                value={departmentId}
                onChange={(v) => setFilter('departmentId', v)}
                options={deptData?.data.map((d) => ({ value: d.id, label: d.name })) ?? []}
                placeholder="All departments"
              />
            </div>
          </>
        )}
        <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
          <Select
            aria-label="Status"
            value={status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: 'PRESENT', label: 'Present' },
              { value: 'ABSENT', label: 'Absent' },
            ]}
            placeholder="All statuses"
          />
        </div>
        <button
          onClick={() => setFilter('flags', onlyFlags ? '' : 'true')}
          className={
            onlyFlags
              ? 'h-9 rounded-xl bg-amber-50 px-space-md font-label-md text-label-md text-amber-600'
              : 'h-9 rounded-xl bg-zinc-50 px-space-md font-label-md text-label-md text-zinc-500 hover:bg-zinc-100'
          }
        >
          Exceptions only
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-card shadow-xs">
        {/*
          A register has seven columns and they do not usefully compress — a
          time squeezed onto two lines is worse than a time you scroll to. So
          the table keeps a floor width and this wrapper scrolls sideways.
        */}
        <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="bg-zinc-50">
              {['Employee', 'Date', 'First in', 'Last out', 'Worked', 'Status', ''].map(
                (h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-space-base py-space-sm text-left font-label-sm text-label-sm uppercase tracking-wider text-zinc-400"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t border-black/[0.06]">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-space-base py-space-md">
                      <div className="h-3 w-20 animate-pulse rounded-xl bg-zinc-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon="event_busy"
                    title="No attendance records"
                    description="Try widening the date range or clearing the filters."
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const key = rowKey(r);
                const isOpen = expanded === key;
                return (
                  /* Fragment needs the key, not the <tr>. A shorthand <> can
                     not take one, so the long form is required here. */
                  <Fragment key={key}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : key)}
                      className="cursor-pointer border-t border-black/[0.06] transition-colors hover:bg-zinc-50"
                    >
                      <td className="h-row-height-compact px-space-base">
                        <div className="flex items-center gap-space-sm">
                          {r.flags.length > 0 && (
                            <span className="icon text-[14px] text-amber-600">
                              warning
                            </span>
                          )}
                          <Avatar name={r.employeeName} photoUrl={r.employeePhotoUrl} size="sm" />
                          <div className="flex flex-col">
                            <span className="font-body-sm text-body-sm font-medium text-zinc-900">
                              {r.employeeName}
                            </span>
                            <span className="font-label-sm text-label-sm text-zinc-400">
                              {r.departmentName}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-space-base font-mono-data text-mono-data text-zinc-500">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-space-base font-mono-data text-mono-data text-zinc-900">
                        {formatTime(r.firstIn)}
                      </td>
                      <td className="px-space-base font-mono-data text-mono-data text-zinc-900">
                        {formatTime(r.lastOut)}
                      </td>
                      <td className="px-space-base font-mono-data text-mono-data text-zinc-500">
                        {formatDuration(r.workedMinutes)}
                      </td>
                      <td className="px-space-base">
                        <div className="flex flex-wrap items-center gap-space-xs">
                          {r.status === 'PRESENT' && (
                            <Chip tone="positive" dot>
                              Present
                            </Chip>
                          )}
                          {r.status === 'ABSENT' && (
                            <Chip tone="danger" dot>
                              Absent
                            </Chip>
                          )}
                          {r.flags.map((f) => (
                            <Chip key={f} tone="warning">
                              {FLAG_LABELS[f]}
                            </Chip>
                          ))}
                        </div>
                      </td>
                      <td className="px-space-base text-right">
                        <span className="icon text-[18px] text-zinc-400">
                          {isOpen ? 'expand_less' : 'expand_more'}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-black/[0.06] bg-zinc-50">
                        <td colSpan={7} className="px-space-base py-space-sm">
                          <p className="mb-space-xs font-label-sm text-label-sm uppercase tracking-wider text-zinc-400">
                            Raw punch events · {r.punchCount} recorded
                          </p>
                          <PunchList employeeId={r.employeeId} date={r.date} />

                          {/* The correction ask lives HERE, next to the raw
                              events, rather than on the row. Somebody disputing
                              a time has just looked at what the kiosk recorded,
                              which is the moment the request makes sense. */}
                          <PermissionGate need="corrections.request">
                            <div className="mt-space-sm flex items-center justify-between gap-space-sm border-t border-black/[0.06] pt-space-sm">
                              <span className="font-label-sm text-label-sm text-zinc-400">
                                Wrong or missing? The punches are never edited — a
                                correction is layered on top and approved by someone else.
                              </span>
                              <Button
                                variant="secondary"
                                icon="edit_calendar"
                                onClick={() => setCorrecting(r)}
                              >
                                Request correction
                              </Button>
                            </div>
                          </PermissionGate>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>

        </div>

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-black/[0.06] px-space-base py-space-sm">
            <span className="font-label-sm text-label-sm text-zinc-500">
              Showing {rows.length} of {data.meta.total}
            </span>
            <div className="flex items-center gap-space-sm">
              <button
                disabled={page <= 1}
                onClick={() => setFilter('page', String(page - 1))}
                className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="font-mono-data text-mono-data text-zinc-500">
                {page} / {data.meta.totalPages}
              </span>
              <button
                disabled={page >= data.meta.totalPages}
                onClick={() => setFilter('page', String(page + 1))}
                className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {correcting && (
        <CorrectionForm
          open
          onClose={() => setCorrecting(null)}
          date={correcting.date}
          employeeId={correcting.employeeId}
          employeeName={correcting.employeeName}
          currentIn={correcting.firstIn}
          currentOut={correcting.lastOut}
        />
      )}

      <ManualPunchModal open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}
