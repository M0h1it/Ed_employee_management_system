/**
 * src/mocks/handlers/tasks.ts
 *
 * Task endpoints.
 *
 * Note how isOverdue is recomputed on every response rather than stored. It
 * depends on today's date, so a stored value would be wrong the next morning.
 * Anything time-relative is computed at read time, never persisted.
 */

import { http, HttpResponse, delay } from 'msw';
import { format } from 'date-fns';
import { EP, EP_PATTERNS } from '@/contracts/endpoints';
import type {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  Paginated,
  Single,
  EmployeeId,
  UserId,
} from '@/contracts/types';
import { tasks, findTask, nextTaskId } from '../fixtures/tasks';
import { findEmployee } from '../fixtures/employees';

const today = () => format(new Date(), 'yyyy-MM-dd');

function withComputed(task: Task): Task {
  return {
    ...task,
    isOverdue:
      task.status !== 'done' && Boolean(task.dueDate) && task.dueDate! < today(),
  };
}

export const taskHandlers = [
  http.get(EP.tasks.list, async ({ request }) => {
    await delay(300);
    const url = new URL(request.url);

    const employeeId = url.searchParams.get('employeeId') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const priority = url.searchParams.get('priority') ?? '';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 50);

    let rows = tasks.map(withComputed);

    if (employeeId) rows = rows.filter((t) => t.employeeId === employeeId);
    if (status) rows = rows.filter((t) => t.status === status);
    if (priority) rows = rows.filter((t) => t.priority === priority);
    if (search) rows = rows.filter((t) => t.title.toLowerCase().includes(search));

    // Overdue first, then by due date, then undated at the end.
    rows.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;

    const body: Paginated<Task> = {
      data: rows.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
    return HttpResponse.json(body);
  }),

  http.post(EP.tasks.list, async ({ request }) => {
    await delay(350);
    const body = (await request.json()) as CreateTaskRequest;

    const employee = findEmployee(body.employeeId);
    const fields: Record<string, string> = {};
    if (!employee) fields.employeeId = 'Choose an employee';
    if (!body.title?.trim()) fields.title = 'Title is required';
    if (Object.keys(fields).length > 0) {
      return HttpResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Please fix the highlighted fields.', fields } },
        { status: 422 },
      );
    }

    /**
     * A self-created task records the person as their own assigner. That
     * distinction matters later: "who gave me this work" and "what did I plan
     * for myself" are different questions, and a single assignedBy field
     * answers both only if it is set honestly here.
     */
    const selfAssigned = Boolean((body as { selfAssigned?: boolean }).selfAssigned);
    const assigner = selfAssigned
      ? { id: `user-${employee!.id.slice(-2)}` as UserId, name: employee!.name }
      : { id: 'user-01' as UserId, name: 'Elena Vance' };

    const task: Task = {
      id: nextTaskId(),
      employeeId: employee!.id as EmployeeId,
      employeeName: employee!.name,
      employeePhotoUrl: employee!.photoUrl,
      assignedBy: assigner.id,
      assignedByName: assigner.name,
      title: body.title.trim(),
      description: body.description ?? '',
      startDate: null,
      dueDate: body.dueDate,
      priority: body.priority,
      status: 'todo',
      completedAt: null,
      createdAt: new Date().toISOString(),
      isOverdue: false,
      selfAssigned,
    };
    tasks.push(task);

    const responseBody: Single<Task> = { data: withComputed(task) };
    return HttpResponse.json(responseBody, { status: 201 });
  }),

  http.patch(EP_PATTERNS.taskDetail, async ({ params, request }) => {
    await delay(250);
    const task = findTask(String(params.id));
    if (!task) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Task not found.' } },
        { status: 404 },
      );
    }
    const body = (await request.json()) as UpdateTaskRequest;
    Object.assign(task, body);

    // Moving a task out of done clears the completion stamp — otherwise a
    // reopened task keeps claiming it was finished.
    if (body.status && body.status !== 'done') task.completedAt = null;

    const responseBody: Single<Task> = { data: withComputed(task) };
    return HttpResponse.json(responseBody);
  }),

  http.patch(EP_PATTERNS.taskComplete, async ({ params }) => {
    await delay(250);
    const task = findTask(String(params.id));
    if (!task) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Task not found.' } },
        { status: 404 },
      );
    }

    task.status = 'done';
    // The server stamps the time, not the browser. A device with a wrong clock
    // would otherwise write a wrong completion time into the record.
    task.completedAt = new Date().toISOString();

    const responseBody: Single<Task> = { data: withComputed(task) };
    return HttpResponse.json(responseBody);
  }),
];
