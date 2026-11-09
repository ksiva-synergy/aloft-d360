import type { AccessSurface, DenyReason, Level } from './types';

export class AccessDeniedError extends Error {
  readonly name = 'AccessDeniedError';

  readonly detail: {
    reason: DenyReason;
    surface: AccessSurface;
    level: Level;
    paths: string[];
    label?: string;
    failedPath?: string;
    requestUrl?: string;
  };

  constructor(
    message: string,
    detail?: {
      reason: DenyReason;
      surface: AccessSurface;
      level: Level;
      paths: string[];
      label?: string;
      failedPath?: string;
      requestUrl?: string;
    },
  ) {
    super(message);
    this.detail = detail ?? {
      reason: 'no_grant',
      surface: 'sql',
      level: 'query',
      paths: [],
    };
  }
}
