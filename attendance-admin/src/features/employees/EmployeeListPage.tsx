/**
 * src/features/employees/EmployeeListPage.tsx
 *
 * The employee directory.
 *
 * WHY FILTERS LIVE IN THE URL
 * ----------------------------
 * Filter state is held in the query string, not in useState. That gives three
 * things free: the back button undoes a filter, a filtered view can be copied
 * and shared as a link, and a page refresh does not reset the work. Putting it
 * in component state loses all three, and retrofitting it later means
 * rewriting every filter handler.
 */

import { useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import PageHeader from '@/components/common/PageHeader';
import DataTable from '@/components/common/DataTable';
import SearchInput from '@/components/common/SearchInput';
import Select from '@/components/common/Select';
import Avatar from '@/components/common/Avatar';
import Chip from '@/components/common/Chip';
import Button from '@/components/common/Button';
import PermissionGate from '@/components/common/PermissionGate';
import { useEmployees, useDepartments } from './api';
import EmployeeForm from './EmployeeForm';
import EmployeeDetailDrawer from './EmployeeDetailDrawer';
import { formatDate } from '@/lib/format';
import type { Employee } from '@/contracts/types';

const PAGE_SIZE = 10;

export default function EmployeeListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Which employee the drawer shows, and which one the form is editing.
  // Kept in component state rather than the URL: they are transient, and a
  // shared link should reproduce a filtered list, not somebody's open drawer.
  const [selected, setSelected] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const search = searchParams.get('search') ?? '';
  const departmentId = searchParams.get('departmentId') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  /** Writes one filter into the URL and resets to page 1. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing a filter while on page 4 would otherwise show an empty table,
    // because the narrowed result set has no page 4.
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading, isError, error } = useEmployees({
    search,
    departmentId: departmentId || undefined,
    status: (status || undefined) as Employee['status'] | undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const { data: deptData } = useDepartments();

  /**
   * useMemo keeps the column definitions stable across renders. Without it a
   * new array is created on every keystroke in the search box, and the table
   * rebuilds its internal state each time.
   */
  const columns = useMemo<ColumnDef<Employee, any>[]>(
    () => [
      {
        id: 'name',
        header: 'Employee',
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex items-center gap-space-sm">
              <Avatar name={e.name} photoUrl={e.photoUrl} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-zinc-900">{e.name}</span>
                <span className="font-mono-data text-mono-data text-zinc-400">
                  {e.empCode}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="truncate text-zinc-500">
              {row.original.email}
            </span>
            <span className="font-mono-data text-mono-data text-zinc-400">
              {row.original.phone}
            </span>
          </div>
        ),
      },
      {
        id: 'department',
        header: 'Department',
        cell: ({ row }) => <Chip>{row.original.departmentName}</Chip>,
      },
      {
        id: 'position',
        header: 'Position',
        cell: ({ row }) => (
          <span className="text-zinc-500">{row.original.position}</span>
        ),
      },
      {
        id: 'role',
        header: 'Login',
        cell: ({ row }) =>
          row.original.hasLogin ? (
            <Chip tone="neutral">{row.original.roleName}</Chip>
          ) : (
            <span className="text-zinc-400">No account</span>
          ),
      },
      {
        id: 'face',
        header: 'Face',
        cell: ({ row }) =>
          row.original.faceEnrolled ? (
            <span className="icon text-[16px] text-emerald-600">
              check_circle
            </span>
          ) : (
            <span className="icon text-[16px] text-zinc-400">remove</span>
          ),
      },
      {
        id: 'joined',
        header: 'Joined',
        cell: ({ row }) => (
          <span className="font-mono-data text-mono-data text-zinc-500">
            {formatDate(row.original.joinDate)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            <Chip tone="positive" dot>
              Active
            </Chip>
          ) : (
            <Chip tone="muted" dot>
              Inactive
            </Chip>
          ),
      },
    ],
    [],
  );

  const departmentOptions =
    deptData?.data.map((d) => ({ value: d.id, label: d.name })) ?? [];

  if (isError) {
    return (
      <>
        <PageHeader title="Employees" />
        <div className="rounded-2xl bg-red-50 px-space-base py-space-md font-body-sm text-body-sm text-red-600">
          Could not load employees. {(error as Error).message}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          data
            ? `${data.meta.total} ${data.meta.total === 1 ? 'person' : 'people'} across ${departmentOptions.length} departments`
            : 'Loading directory…'
        }
        actions={
          <PermissionGate need="employees.create">
            <Button
              icon="add"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add employee
            </Button>
          </PermissionGate>
        }
      />

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full min-w-[200px] sm:flex-1">
          <SearchInput
            value={search}
            onChange={(v) => setFilter('search', v)}
            placeholder="Search by name, code or email…"
          />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-[180px]">
          <Select
            aria-label="Filter by department"
            value={departmentId}
            onChange={(v) => setFilter('departmentId', v)}
            options={departmentOptions}
            placeholder="All departments"
          />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All statuses"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        total={data?.meta.total ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setFilter('page', String(p))}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No employees match those filters"
        emptyDescription="Try clearing the search box or choosing a different department."
      />

      <EmployeeDetailDrawer
        employee={selected}
        onClose={() => setSelected(null)}
        onEdit={(employee) => {
          setSelected(null); // close the drawer so the modal is not stacked on it
          setEditing(employee);
          setFormOpen(true);
        }}
      />

      <EmployeeForm open={formOpen} onOpenChange={setFormOpen} employee={editing} />
    </>
  );
}
