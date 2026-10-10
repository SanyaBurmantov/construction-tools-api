import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-request';
import type { AuthenticatedUser } from './auth.service';

/** The account behind the request; guaranteed by AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authUser!,
);

/** The session row behind the request, so "log out this device" can target it. */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authSessionId!,
);

/**
 * The acting admin's id, or undefined when the call authenticated with the
 * `x-admin-token` service header. The user-management service uses it to refuse
 * "lock myself out" edits.
 */
export const ActingAdminId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authUser?.id,
);

/**
 * The account id when there is one, undefined for a guest. Pair it with
 * `OptionalAuthGuard` on endpoints that serve both.
 */
export const OptionalUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authUser?.id,
);
