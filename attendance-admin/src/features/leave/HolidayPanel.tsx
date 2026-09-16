/**
 * src/features/leave/HolidayPanel.tsx
 *
 * Company holidays, shown inside Settings.
 *
 * WHY IT LIVES UNDER SETTINGS
 * ----------------------------
 * A holiday list is company policy, set once or twice a year — not a daily
 * workflow. Giving it its own sidebar entry would put a page nobody opens
 * alongside pages people use every day, and a navigation full of rarely-used
 * items is one people stop reading.
 */

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import EmptyState from '@/components/common/EmptyState';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useHolidays, useCreateHoliday, useDeleteHoliday } from './api';
import { ApiException } from '@/lib/apiClient';

export default function HolidayPanel() {
  const year = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(year);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const { data, isLoading } = useHolidays(selectedYear);
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const confirm = useConfirm();
  const toast = useToast();

  const holidays = data?.data ?? [];

  async function add() {
    setFieldError(null);
    try {
      await create.mutateAsync({ date, name: name.trim() });
      toast('Holiday added', 'success');
      setDate('');
      setName('');
    } catch (error) {
      if (error instanceof ApiException && error.fields?.date) {
        setFieldError(error.fields.date);
        return;
      }
      toast(error instanceof ApiException ? error.message : 'Could not add the holiday', 'error');
    }
  }

  async function drop(id: string, label: string, when: string) {
    const ok = await confirm({
      title: 'Remove this holiday?',
      // The consequence is spelled out because it is not obvious: attendance
      // days are derived, so removing a holiday reclassifies a past day for
      // everybody, all at once.
      description:
        `${label} on ${format(parseISO(when), 'dd MMM yyyy')} will be removed. ` +
        'That day will go back to being counted as a working day for everyone, ' +
        'which may turn it into a company-wide absence in past reports.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await remove.mutateAsync(id);
      toast('Holiday removed', 'success');
    } catch {
      toast('Could not remove the holiday', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h3 className="font-headline-sm text-headline-sm text-zinc-900">Company holidays</h3>
        <p className="mt-space-xxs font-body-sm text-body-sm text-zinc-500">
          A day listed here is not counted as a working day. Without it, a day nobody
          punches in reads as the whole company being absent.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-space-sm">
        <div className="w-[170px]">
          <FormField label="Date" error={fieldError ?? undefined}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls(!!fieldError)}
            />
          </FormField>
        </div>
        <div className="min-w-[200px] flex-1">
          <FormField label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Independence Day"
              className={inputCls()}
            />
          </FormField>
        </div>
        <Button onClick={add} disabled={!date || name.trim().length < 2 || create.isPending}>
          Add
        </Button>
      </div>

      <div className="flex items-center gap-space-sm">
        {[year - 1, year, year + 1].map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={
              selectedYear === y
                ? 'rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-semibold text-white'
                : 'rounded-lg px-3 py-1.5 text-[12px] font-semibold text-zinc-500 hover:bg-zinc-50'
            }
          >
            {y}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-space-xs">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : holidays.length === 0 ? (
        <EmptyState
          icon="event"
          title={`No holidays set for ${selectedYear}`}
          description="Add them before the year starts, so the register is right from day one."
        />
      ) : (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06]">
          {holidays.map((holiday) => (
            <li key={holiday.id} className="flex items-center gap-space-md px-space-base py-space-sm">
              <span className="w-[110px] shrink-0 font-mono-data text-mono-data text-zinc-500">
                {format(parseISO(holiday.date), 'dd MMM yyyy')}
              </span>
              <span className="w-[42px] shrink-0 font-label-sm text-label-sm text-zinc-400">
                {format(parseISO(holiday.date), 'EEE')}
              </span>
              <span className="flex-1 font-body-sm text-body-sm text-zinc-800">{holiday.name}</span>
              <button
                onClick={() => drop(holiday.id, holiday.name, holiday.date)}
                aria-label={`Remove ${holiday.name}`}
                className="icon rounded-lg p-1 text-[16px] text-zinc-300 hover:bg-red-50 hover:text-red-600"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
