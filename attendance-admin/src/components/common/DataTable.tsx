/**
 * src/components/common/DataTable.tsx
 *
 * The table used by every list screen in the app.
 *
 * WHY manualPagination IS TRUE
 * -----------------------------
 * TanStack Table can paginate a full in-memory array for you. That only works
 * if the browser already holds every row — fine for twelve employees, useless
 * for two thousand attendance records. Telling it the server handles paging
 * means the same component works at both sizes, and Phase 2 changes nothing.
 *
 * The same reasoning applies to sorting and filtering: the server does them,
 * because it is the only side that can see all the data.
 */

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import clsx from 'clsx';
import EmptyState from './EmptyState';

interface Props<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  isLoading?: boolean;
  /** Row count across ALL pages, from the server's meta block. */
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** How many skeleton rows to draw while loading. */
  skeletonRows?: number;
}

export default function DataTable<T>({
  columns,
  data,
  isLoading = false,
  total = 0,
  page = 1,
  pageSize = 10,
  onPageChange,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  skeletonRows = 8,
}: Props<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPager = totalPages > 1 && onPageChange;

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-zinc-50">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="whitespace-nowrap px-space-base py-space-sm text-left font-label-sm text-label-sm uppercase tracking-wider text-zinc-400"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {isLoading ? (
              /* Skeleton rows rather than a spinner: the table keeps its shape,
                 so the page does not jump when the data lands. */
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="border-t border-black/[0.06]">
                  {columns.map((_col, j) => (
                    <td key={j} className="px-space-base py-space-md">
                      <div className="h-3 w-24 animate-pulse rounded-xl bg-zinc-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={clsx(
                    'border-t border-black/[0.06] transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-zinc-50',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="h-row-height-compact px-space-base align-middle font-body-sm text-body-sm text-zinc-900"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPager && (
        <div className="flex items-center justify-between border-t border-black/[0.06] px-space-base py-space-sm">
          <span className="font-label-sm text-label-sm text-zinc-500">
            Showing {data.length} of {total}
          </span>
          <div className="flex items-center gap-space-sm">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="font-mono-data text-mono-data text-zinc-500">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
