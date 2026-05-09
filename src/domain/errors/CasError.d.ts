export interface CasErrorOptions {
  message: string;
  code: string;
  meta?: Record<string, unknown>;
  documentationUrl?: string;
}

export interface SerializedCasError {
  name: string;
  message: string;
  code: string;
  documentationUrl?: string;
  meta?: Record<string, unknown>;
}

export default class CasError extends Error {
  code: string;
  meta: Record<string, unknown>;
  documentationUrl?: string;

  constructor(
    messageOrOptions: string | CasErrorOptions,
    code?: string,
    meta?: Record<string, unknown>,
  );

  toJSON(): SerializedCasError;
}
