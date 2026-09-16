/**
 * src/mocks/handlers/org.ts
 *
 * Reference data: departments and shifts. Used by filters and forms.
 */

import { http, HttpResponse } from 'msw';
import { EP } from '@/contracts/endpoints';
import type { Department, Shift, Single } from '@/contracts/types';
import { departments, shifts } from '../fixtures/org';

export const orgHandlers = [
  http.get(EP.org.departments, () => {
    const body: Single<Department[]> = { data: departments };
    return HttpResponse.json(body);
  }),

  http.get(EP.org.shifts, () => {
    const body: Single<Shift[]> = { data: shifts };
    return HttpResponse.json(body);
  }),
];
