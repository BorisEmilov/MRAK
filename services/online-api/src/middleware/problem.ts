import type { Response } from 'express';

/** Error codes and their titles (RFC 9457 problem details; never stack traces). */
export const PROBLEMS = {
  bad_request: 'The request is not valid.',
  unauthorized: 'Authentication is required.',
  forbidden: 'This action is not allowed.',
  not_found: 'Not found.',
  conflict: 'The request conflicts with the current state.',
  unsupported_media_type: 'Unsupported content type or encoding.',
  payload_too_large: 'The request body is too large.',
  too_many_requests: 'Too many requests. Try again later.',
  captcha_required: 'Complete the human check and try again.',
  weak_password: 'Choose a longer or less common password.',
  email_not_allowed: 'This email address cannot be used.',
  email_not_verified: 'Verify your email address first.',
  invalid_credentials: 'Email or password is incorrect.',
  invalid_token: 'The link or token is invalid or has expired.',
  internal_error: 'Something went wrong.',
  unavailable: 'The service is unavailable. Try again later.',
  timeout: 'The request took too long.',
} as const;
export type ProblemCode = keyof typeof PROBLEMS;

/** Sends `application/problem+json`. `error` repeats the code for simple clients. */
export function problem(
  res: Response,
  status: number,
  code: ProblemCode,
  extra: Record<string, unknown> = {},
): void {
  res
    .status(status)
    .type('application/problem+json')
    .json({
      type: `https://mrak.game/problems/${code.replaceAll('_', '-')}`,
      title: PROBLEMS[code],
      status,
      error: code,
      ...extra,
    });
}
