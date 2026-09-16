/**
 * src/features/attendance/PunchList.tsx
 *
 * The raw events behind one day. This is the audit trail made visible.
 *
 * Showing confidence and source next to each punch matters: when someone
 * disputes a record, "the kiosk matched your face at 91% at 09:14" is a very
 * different conversation from "the system says you were late".
 */

import { usePunches } from './api';
import { formatTime } from '@/lib/format';
import Chip from '@/components/common/Chip';

interface Props {
  employeeId: string;
  date: string;
}

export default function PunchList({ employeeId, date }: Props) {
  const { data, isLoading } = usePunches(employeeId, date);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-space-xs py-space-sm">
        {[0, 1].map((i) => (
          <div key={i} className="h-6 w-64 animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  const punches = data?.data ?? [];

  if (punches.length === 0) {
    return (
      <p className="py-space-sm font-body-sm text-body-sm text-zinc-400">
        No punch events recorded for this day.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-space-xs py-space-xs">
      {punches.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs">
          <span
            className={
              p.direction === 'IN'
                ? 'icon text-[16px] text-emerald-600'
                : 'icon text-[16px] text-zinc-400'
            }
          >
            {p.direction === 'IN' ? 'login' : 'logout'}
          </span>
          <span className="w-24 font-mono-data text-mono-data text-zinc-900">
            {formatTime(p.ts)}
          </span>
          <Chip tone={p.direction === 'IN' ? 'positive' : 'muted'}>{p.direction}</Chip>
          <span className="font-body-sm text-body-sm text-zinc-500">
            {p.deviceName ?? 'Admin entry'}
          </span>
          {p.confidence !== null && (
            <span className="font-mono-data text-mono-data text-zinc-400">
              {Math.round(p.confidence * 100)}% match
            </span>
          )}
          {p.source === 'manual' && <Chip tone="warning">Manual</Chip>}
        </li>
      ))}
    </ol>
  );
}
