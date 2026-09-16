/**
 * src/mocks/handlers/auth.ts
 *
 * A fake login endpoint.
 *
 * MSW intercepts the request at the network layer using a Service Worker, so
 * the application code performs a real fetch and the request appears in the
 * browser's Network tab. Nothing in the app knows this is a mock — which is
 * exactly why switching to the real backend later changes nothing but one line
 * in main.tsx.
 *
 * Note how the permission array is RESOLVED here, from the user's role. The
 * real server will do the same, for the same reason: the client must never
 * have to work out what a role means, because that logic has to exist on the
 * server anyway for enforcement and two copies would eventually disagree.
 */

import { http, HttpResponse, delay } from 'msw';
import { EP } from '@/contracts/endpoints';
import type {
  LoginRequest,
  LoginResponse,
  CurrentUser,
  Single,
} from '@/contracts/types';
import { findUserByUsername, mockPasswords } from '../fixtures/users';
import { findRole } from '../fixtures/roles';
import { findEmployee } from '../fixtures/employees';

/** Remembers who logged in, so GET /me can answer. */
let signedInUsername: string | null = null;

/**
 * The signed-in user, for other handlers.
 *
 * A real server reads the actor from the bearer token on every request, and it
 * MUST — an endpoint that trusts the client to say who it is can be told
 * anything. This is the mock's stand-in for that, kept in one place so the
 * authorisation checks below read the same way they will in FastAPI.
 */
export function currentActor() {
  if (!signedInUsername) return null;
  return findUserByUsername(signedInUsername) ?? null;
}

function buildCurrentUser(username: string): CurrentUser | null {
  const user = findUserByUsername(username);
  if (!user) return null;

  const role = findRole(user.roleId);
  const employee = findEmployee(user.employeeId);
  if (!role || !employee) return null;

  return {
    id: user.id,
    employeeId: user.employeeId,
    name: employee.name,
    email: employee.email,
    username: user.username,
    photoUrl: employee.photoUrl,
    departmentName: employee.departmentName,
    position: employee.position,
    roleName: role.name,
    permissions: role.permissions, // resolved server-side, sent flat
    mustChangePassword: user.mustChangePassword,
    attendanceTracked: employee.attendanceTracked,
  };
}

export const authHandlers = [
  http.post(EP.auth.login, async ({ request }) => {
    // A small delay so loading spinners are actually visible during
    // development. Without it every request resolves instantly and you never
    // notice that you forgot to build a loading state.
    await delay(400);

    const body = (await request.json()) as LoginRequest;
    const user = findUserByUsername(body.username);

    // One generic message for both wrong-username and wrong-password.
    // Saying "no such user" would let anyone enumerate valid usernames.
    if (!user || mockPasswords[user.username] !== body.password) {
      return HttpResponse.json(
        {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Incorrect username or password.',
          },
        },
        { status: 401 },
      );
    }

    if (!user.isActive) {
      return HttpResponse.json(
        {
          error: {
            code: 'ACCOUNT_DISABLED',
            message: 'This account has been disabled. Contact your administrator.',
          },
        },
        { status: 403 },
      );
    }

    const currentUser = buildCurrentUser(user.username)!;
    signedInUsername = user.username;

    const response: LoginResponse = {
      accessToken: `mock-token-${user.id}`,
      user: currentUser,
    };
    return HttpResponse.json(response);
  }),

  http.get(EP.auth.me, () => {
    if (!signedInUsername) {
      return HttpResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Not signed in.' } },
        { status: 401 },
      );
    }
    const body: Single<CurrentUser> = {
      data: buildCurrentUser(signedInUsername)!,
    };
    return HttpResponse.json(body);
  }),

  http.post(EP.auth.logout, () => {
    signedInUsername = null;
    return new HttpResponse(null, { status: 204 });
  }),
];
