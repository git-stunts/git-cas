import { HINTS } from '../actions.js';

export const AGENT_PROTOCOL = 'git-cas-agent/v1';

export const AGENT_EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
  INVALID_INPUT: 2,
  VERIFICATION_FAILED: 3,
});

/**
 * Map an operational error to an agent exit code.
 *
 * @param {unknown} err
 * @returns {number}
 */
export function getAgentExitCode(err) {
  const code = getErrorCode(err);

  if (code === 'INVALID_INPUT' || code === 'NEEDS_INPUT') {
    return AGENT_EXIT_CODES.INVALID_INPUT;
  }

  if (code === 'INTEGRITY_ERROR') {
    return AGENT_EXIT_CODES.VERIFICATION_FAILED;
  }

  return AGENT_EXIT_CODES.FAILURE;
}

/**
 * Normalize an error into the JSONL protocol shape.
 *
 * @param {unknown} err
 * @returns {{ code: string, message: string, retryable: boolean, hint?: string, meta?: Record<string, any> }}
 */
export function normalizeAgentError(err) {
  const code = getErrorCode(err) || 'ERROR';
  const message = getErrorMessage(err);
  const retryable = getErrorRetryable(err);

  /** @type {{ code: string, message: string, retryable: boolean, hint?: string, meta?: Record<string, any> }} */
  const data = { code, message, retryable };

  if (Object.prototype.hasOwnProperty.call(HINTS, code)) {
    data.hint = HINTS[code];
  }

  const meta = getErrorMeta(err);
  if (meta) {
    data.meta = meta;
  }

  return data;
}

/**
 * @param {unknown} err
 * @returns {string | undefined}
 */
function getErrorCode(err) {
  if (typeof err === 'object' && err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function getErrorRetryable(err) {
  if (typeof err === 'object' && err && typeof err.retryable === 'boolean') {
    return err.retryable;
  }
  return false;
}

/**
 * @param {unknown} err
 * @returns {Record<string, any> | undefined}
 */
function getErrorMeta(err) {
  if (
    typeof err === 'object' &&
    err &&
    err.meta &&
    typeof err.meta === 'object' &&
    !Array.isArray(err.meta)
  ) {
    return err.meta;
  }
  return undefined;
}

/**
 * Create a JSONL session writer for the agent protocol.
 *
 * @param {{
 *   command: string,
 *   stdout?: Pick<NodeJS.WriteStream, 'write'>,
 *   stderr?: Pick<NodeJS.WriteStream, 'write'>,
 *   now?: () => Date,
 * }} options
 */
export function createAgentSession({
  command,
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => new Date(),
}) {
  let seq = 0;

  /**
   * @param {Pick<NodeJS.WriteStream, 'write'>} stream
   * @param {string} type
   * @param {Record<string, any>} data
   */
  function write(stream, type, data) {
    seq += 1;
    const row = {
      protocol: AGENT_PROTOCOL,
      command,
      type,
      seq,
      ts: now().toISOString(),
      data,
    };
    stream.write(`${JSON.stringify(row)}\n`);
  }

  return {
    writeStart(data = {}) {
      write(stdout, 'start', data);
    },
    writeProgress(data) {
      write(stdout, 'progress', data);
    },
    writeResult(data) {
      write(stdout, 'result', data);
    },
    writeEnd(data) {
      write(stdout, 'end', data);
    },
    writeWarning(data) {
      write(stderr, 'warning', data);
    },
    writeNeedsInput(data) {
      write(stderr, 'needs-input', data);
    },
    writeError(err) {
      write(stderr, 'error', normalizeAgentError(err));
    },
  };
}
