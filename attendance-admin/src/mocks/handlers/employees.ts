/**
 * src/mocks/handlers/employees.ts
 *
 * The employees endpoint, mocked.
 *
 * Read this file closely — it does everything the real FastAPI handler will do:
 * reads query params, filters, sorts, slices a page, and returns the paginated
 * envelope. Writing the mock this faithfully is what makes the Phase 2 swap a
 * non-event. A mock that just returns the whole array would let the UI develop
 * bad habits that break the day a real server answers.
 */

import { http, HttpResponse, delay } from 'msw';
import { EP, EP_PATTERNS } from '@/contracts/endpoints';
import type {
  Employee,
  EmployeeId,
  Paginated,
  Single,
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from '@/contracts/types';
import { employees, findEmployee } from '../fixtures/employees';
import { departments } from '../fixtures/org';

export const employeeHandlers = [
  http.get(EP.employees.list, async ({ request }) => {
    await delay(300);

    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const departmentId = url.searchParams.get('departmentId') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);

    let rows = [...employees];

    if (search) {
      rows = rows.filter(
        (e) =>
          e.name.toLowerCase().includes(search) ||
          e.empCode.toLowerCase().includes(search) ||
          e.email.toLowerCase().includes(search),
      );
    }
    if (departmentId) rows = rows.filter((e) => e.departmentId === departmentId);
    if (status) rows = rows.filter((e) => e.status === status);

    rows.sort((a, b) => a.name.localeCompare(b.name));

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const body: Paginated<Employee> = {
      data: pageRows,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
    return HttpResponse.json(body);
  }),

  http.get(EP_PATTERNS.employeeDetail, async ({ params }) => {
    await delay(200);
    const employee = findEmployee(String(params.id));
    if (!employee) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Employee not found.' } },
        { status: 404 },
      );
    }
    const body: Single<Employee> = { data: employee };
    return HttpResponse.json(body);
  }),

  http.post(EP.employees.list, async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as CreateEmployeeRequest;

    // Server-side validation, mocked faithfully. The form validates too, but a
    // form can be bypassed — the server is the one that must not be optional.
    const fields: Record<string, string> = {};
    if (!body.name?.trim()) fields.name = 'Name is required';
    if (!body.email?.trim()) fields.email = 'Email is required';
    if (employees.some((e) => e.email.toLowerCase() === body.email?.toLowerCase())) {
      fields.email = 'This email is already in use';
    }
    if (!/^[6-9]\d{9}$/.test(body.phone ?? '')) {
      fields.phone = 'Enter a valid 10-digit mobile number';
    }
    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Please fix the highlighted fields.', fields } },
        { status: 422 },
      );
    }

    const nextNumber = employees.length + 1;
    const employee: Employee = {
      id: `emp-${String(nextNumber).padStart(2, '0')}` as EmployeeId,
      empCode: `EMP-${String(nextNumber).padStart(4, '0')}`,
      name: body.name.trim(),
      email: body.email.trim(),
      phone: body.phone,
      photoUrl: null,
      departmentId: body.departmentId,
      departmentName:
        departments.find((d) => d.id === body.departmentId)?.name ?? 'Unassigned',
      position: body.position,
      shiftId: body.shiftId,
      joinDate: body.joinDate,
      status: 'active',
      faceEnrolled: false,
      hasLogin: false,
      roleName: null,
      attendanceTracked: true,
    };
    employees.push(employee);

    const responseBody: Single<Employee> = { data: employee };
    return HttpResponse.json(responseBody, { status: 201 });
  }),

  http.patch(EP_PATTERNS.employeeDetail, async ({ params, request }) => {
    await delay(400);
    const employee = findEmployee(String(params.id));
    if (!employee) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Employee not found.' } },
        { status: 404 },
      );
    }

    const body = (await request.json()) as UpdateEmployeeRequest;

    if (body.email && employees.some(
      (e) => e.id !== employee.id && e.email.toLowerCase() === body.email!.toLowerCase(),
    )) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please fix the highlighted fields.',
            fields: { email: 'This email is already in use' },
          },
        },
        { status: 422 },
      );
    }

    Object.assign(employee, body);
    if (body.departmentId) {
      employee.departmentName =
        departments.find((d) => d.id === body.departmentId)?.name ?? employee.departmentName;
    }

    const responseBody: Single<Employee> = { data: employee };
    return HttpResponse.json(responseBody);
  }),
];
