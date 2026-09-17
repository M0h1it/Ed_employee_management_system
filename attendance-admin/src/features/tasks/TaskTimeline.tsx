/**
 * src/features/tasks/TaskTimeline.tsx
 *
 * Who is working on what, and until when.
 *
 * ONE ROW PER PERSON
 * ------------------
 * The question this answers is "who is loaded and who is free". That is only
 * readable when one person's work sits on one line. A flat list of bars sorted
 * by date answers "what is due soon" instead — which the table underneath the
 * chart already does, and does better.
 *
 * NOT A GANTT CHART, DELIBERATELY
 * --------------------------------
 * No dependencies, no drag-to-resize, no critical path. Those are a week of
 * work and they answer questions nobody here is asking yet. A bar with a start,
 * an end and a today line covers the ninety percent: what is running, what is
 * late, when it ends.
 */

import { useMemo } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  isSameMonth,
  isWeekend,
  parseISO,
  startOfDay,
} from 'date-fns';
import clsx from 'clsx';
import Avatar from '@/components/common/Avatar';
import EmptyState from '@/components/common/EmptyState';
import Tooltip from '@/components/common/Tooltip';
import type { TimelineBar, TimelineRange, TimelineRow } from '@/contracts/types';

/** How far back and forward each range looks. */
const RANGES: Record<TimelineRange, { before: number; after: number; label: string }> = {
  '2w': { before: 3, after: 10, label: '2 weeks' },
  '1m': { before: 7, after: 23, label: '1 month' },
  '3m': { before: 14, after: 76, label: '3 months' },
};

/**
 * Bar colour carries STATUS, not priority.
 *
 * Priority is already on the task card and in the table. On a chart, the thing
 * the eye should pick out is what is late — colouring by priority would leave a
 * wall of red that says nothing about whether anything is wrong.
 */
function barTone(bar: TimelineBar): string {
  if (bar.isOverdue) return 'bg-red-500';
  if (bar.status === 'done') return 'bg-emerald-500/70';
  if (bar.status === 'in_progress') return 'bg-indigo-600';
  return 'bg-indigo-300';
}

interface Props {
  rows: TimelineRow[];
  range: TimelineRange;
  onRangeChange: (range: TimelineRange) => void;
  isLoading: boolean;
  /** Hides the header when only one person is shown. */
  singlePerson?: boolean;
}

export default function TaskTimeline({
  rows,
  range,
  onRangeChange,
  isLoading,
  singlePerson,
}: Props) {
  const { days, today, dayWidth } = useMemo(() => {
    const config = RANGES[range];
    const start = startOfDay(addDays(new Date(), -config.before));
    const end = startOfDay(addDays(new Date(), config.after));
    return {
      days: eachDayOfInterval({ start, end }),
      today: startOfDay(new Date()),
      // Narrower cells on the longer ranges, so three months still fits a
      // reasonable scroll rather than a kilometre of chart.
      dayWidth: range === '3m' ? 14 : range === '1m' ? 26 : 44,
    };
  }, [range]);

  const first = days[0];
  const totalWidth = days.length * dayWidth;

  /**
   * Bars are CLIPPED to the window, not dropped.
   *
   * Work that started before the view opened is still running now, and hiding
   * it would make a busy person look free. The bar simply begins at the left
   * edge — and the same at the right for work that runs past the end.
   */
  function geometry(bar: TimelineBar) {
    const barStart = parseISO(bar.startDate);
    const barEnd = parseISO(bar.endDate);

    const startOffset = Math.max(0, differenceInCalendarDays(barStart, first));
    const endOffset = Math.min(days.length - 1, differenceInCalendarDays(barEnd, first));

    if (endOffset < 0 || startOffset > days.length - 1) return null; // fully outside

    return {
      left: startOffset * dayWidth,
      width: Math.max(dayWidth - 4, (endOffset - startOffset + 1) * dayWidth - 4),
      clippedLeft: barStart < first,
      clippedRight: barEnd > days[days.length - 1],
    };
  }

  /**
   * Stacks overlapping bars onto separate lines within one person's row.
   *
   * Two tasks on the same days would otherwise sit on top of each other and one
   * would be invisible — which is exactly the case worth seeing, because it
   * means somebody is double-booked.
   */
  function lanes(bars: TimelineBar[]) {
    const placed: { bar: TimelineBar; lane: number }[] = [];
    const laneEnds: number[] = [];

    for (const bar of [...bars].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      const startOffset = differenceInCalendarDays(parseISO(bar.startDate), first);
      const endOffset = differenceInCalendarDays(parseISO(bar.endDate), first);

      let lane = laneEnds.findIndex((end) => end < startOffset);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endOffset);
      } else {
        laneEnds[lane] = endOffset;
      }
      placed.push({ bar, lane });
    }
    return { placed, laneCount: Math.max(1, laneEnds.length) };
  }

  const todayOffset = differenceInCalendarDays(today, first) * dayWidth;

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-black/[0.06] px-space-base py-space-md">
        <div className="flex flex-col">
          <h2 className="font-headline-md text-headline-md text-zinc-900">
            {singlePerson ? 'My timeline' : 'Team timeline'}
          </h2>
          <p className="mt-0.5 font-mono-data text-mono-data text-zinc-400">
            {format(first, 'dd MMM')} – {format(days[days.length - 1], 'dd MMM yyyy')}
          </p>
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-xl border border-black/[0.08] bg-card p-0.5 shadow-xs">
          {(Object.keys(RANGES) as TimelineRange[]).map((key) => (
            <button
              key={key}
              onClick={() => onRangeChange(key)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[12px] font-semibold',
                range === key
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900',
              )}
            >
              {RANGES[key].label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-space-sm p-space-base">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="calendar_month"
          title="Nothing scheduled"
          description="Tasks need a start date and a due date to appear here."
        />
      ) : (
        <div className="flex">
          {/* Names stay pinned. A bar with no visible row label tells you
              nothing, and the chart scrolls sideways by design. */}
          <div className="sticky left-0 z-20 shrink-0 border-r border-black/[0.06] bg-card">
            <div className="h-10 border-b border-black/[0.06]" />
            {rows.map((row) => {
              const { laneCount } = lanes(row.bars);
              return (
                <div
                  key={row.employeeId}
                  style={{ height: laneCount * 30 + 14 }}
                  className="flex w-[180px] items-center gap-space-sm border-b border-black/[0.06] px-space-md sm:w-[210px]"
                >
                  <Avatar name={row.employeeName} photoUrl={row.employeePhotoUrl} size="sm" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-body-sm text-[12px] font-semibold text-zinc-800">
                      {row.employeeName}
                    </span>
                    <span className="truncate font-label-sm text-label-sm text-zinc-400">
                      {row.bars.length === 0 ? 'Free' : `${row.bars.length} tasks`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ width: totalWidth }} className="relative">
              {/* Date scale */}
              <div className="flex h-10 border-b border-black/[0.06]">
                {days.map((day, index) => {
                  const showMonth = index === 0 || !isSameMonth(day, days[index - 1]);
                  return (
                    <div
                      key={day.toISOString()}
                      style={{ width: dayWidth }}
                      className={clsx(
                        'flex shrink-0 flex-col items-center justify-center border-r border-black/[0.04]',
                        isWeekend(day) && 'bg-zinc-50',
                      )}
                    >
                      {showMonth && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                          {format(day, 'MMM')}
                        </span>
                      )}
                      <span
                        className={clsx(
                          'font-mono-data text-[10px]',
                          day.getTime() === today.getTime()
                            ? 'font-bold text-indigo-600'
                            : 'text-zinc-400',
                        )}
                      >
                        {format(day, range === '3m' ? 'd' : 'dd')}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Today line, over everything. The single most-read element on
                  the chart — without it a bar's position means nothing. */}
              {todayOffset >= 0 && todayOffset <= totalWidth && (
                <div
                  style={{ left: todayOffset + dayWidth / 2 }}
                  className="pointer-events-none absolute bottom-0 top-10 z-10 w-px bg-indigo-500/60"
                >
                  <span className="absolute -top-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-indigo-500" />
                </div>
              )}

              {rows.map((row) => {
                const { placed, laneCount } = lanes(row.bars);
                return (
                  <div
                    key={row.employeeId}
                    style={{ height: laneCount * 30 + 14 }}
                    className="relative border-b border-black/[0.06]"
                  >
                    {/* Weekend shading, so a bar spanning a weekend reads as
                        five working days rather than seven. */}
                    <div className="absolute inset-0 flex">
                      {days.map((day) => (
                        <div
                          key={day.toISOString()}
                          style={{ width: dayWidth }}
                          className={clsx(
                            'shrink-0 border-r border-black/[0.03]',
                            isWeekend(day) && 'bg-zinc-50/70',
                          )}
                        />
                      ))}
                    </div>

                    {placed.map(({ bar, lane }) => {
                      const box = geometry(bar);
                      if (!box) return null;
                      // Below this width, even one character would clip —
                      // showing a solid, unlabelled bar is more honest than
                      // rendering text that cannot be read at all. The
                      // tooltip (always available on hover, regardless of
                      // width) is what actually answers "what is this".
                      const tooManyNarrowForLabel = box.width < 28;
                      return (
                        <Tooltip
                          key={bar.taskId}
                          content={
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold">{bar.title}</span>
                              <span className="text-zinc-300">
                                {format(parseISO(bar.startDate), 'dd MMM')} –{' '}
                                {format(parseISO(bar.endDate), 'dd MMM yyyy')}
                                {bar.isOverdue && ' · Overdue'}
                              </span>
                            </div>
                          }
                        >
                          <div
                            style={{
                              left: box.left + 2,
                              width: box.width,
                              top: lane * 30 + 8,
                            }}
                            className={clsx(
                              'absolute flex h-[22px] cursor-default items-center overflow-hidden px-2 text-[10.5px] font-semibold text-white',
                              barTone(bar),
                              // A flat edge signals the bar continues beyond the
                              // window; a rounded one signals it really ends here.
                              box.clippedLeft ? 'rounded-l-none' : 'rounded-l-md',
                              box.clippedRight ? 'rounded-r-none' : 'rounded-r-md',
                              bar.status === 'done' && 'line-through opacity-80',
                            )}
                          >
                            {!tooManyNarrowForLabel && (
                              <span className="truncate">{bar.title}</span>
                            )}
                          </div>
                        </Tooltip>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-space-base border-t border-black/[0.06] px-space-base py-space-sm font-label-sm text-label-sm text-zinc-500">
        {[
          { tone: 'bg-indigo-300', label: 'To do' },
          { tone: 'bg-indigo-600', label: 'In progress' },
          { tone: 'bg-emerald-500/70', label: 'Done' },
          { tone: 'bg-red-500', label: 'Overdue' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-space-xs">
            <span className={clsx('h-2.5 w-4 rounded-sm', item.tone)} />
            {item.label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-space-xs">
          <span className="h-3 w-px bg-indigo-500" />
          Today
        </span>
      </div>
    </section>
  );
}