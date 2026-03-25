import { describe, it, expect, vi } from 'vitest';
import {
  AGENT_EXIT_CODES,
  AGENT_PROTOCOL,
  createAgentSession,
  getAgentExitCode,
} from '../../../bin/agent/protocol.js';

function createFakeStream() {
  const writes = [];
  return {
    writes,
    write: vi.fn((chunk) => {
      writes.push(String(chunk));
      return true;
    }),
  };
}

function defineAgentSessionStdoutTests() {
  it('writes ordered protocol rows to stdout', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    const session = createAgentSession({
      command: 'inspect',
      stdout,
      stderr,
      now: () => new Date('2026-03-25T19:15:00.000Z'),
    });

    session.writeStart({ argv: ['inspect', '--slug', 'demo/hello'] });
    session.writeResult({ treeOid: 'abc123' });
    session.writeEnd({ ok: true, exitCode: 0 });

    const rows = stdout.writes.map((line) => JSON.parse(line));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.protocol === AGENT_PROTOCOL)).toBe(true);
    expect(rows.every((row) => row.command === 'inspect')).toBe(true);
    expect(rows[1].data).toEqual({ treeOid: 'abc123' });
    expect(stderr.write).not.toHaveBeenCalled();
  });
}

function defineAgentSessionErrorTests() {
  it('writes structured errors to stderr with the shared sequence', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    const session = createAgentSession({
      command: 'inspect',
      stdout,
      stderr,
      now: () => new Date('2026-03-25T19:15:00.000Z'),
    });

    session.writeStart({ argv: ['inspect'] });
    session.writeError(
      Object.assign(new Error('Provide --slug <slug> or --oid <tree-oid>'), {
        code: 'INVALID_INPUT',
        meta: { command: 'inspect' },
      })
    );
    session.writeEnd({ ok: false, exitCode: 2 });

    const stdoutRows = stdout.writes.map((line) => JSON.parse(line));
    const stderrRows = stderr.writes.map((line) => JSON.parse(line));

    expect(stdoutRows.map((row) => row.seq)).toEqual([1, 3]);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      protocol: AGENT_PROTOCOL,
      command: 'inspect',
      type: 'error',
      seq: 2,
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --slug <slug> or --oid <tree-oid>',
        retryable: false,
        hint: 'Check the agent command name and required input fields',
        meta: { command: 'inspect' },
      },
    });
  });
}

function defineAgentExitCodeTests() {
  it('maps invalid input to exit code 2', () => {
    expect(getAgentExitCode(Object.assign(new Error('bad args'), { code: 'INVALID_INPUT' }))).toBe(
      AGENT_EXIT_CODES.INVALID_INPUT
    );
  });

  it('maps integrity errors to exit code 3', () => {
    expect(
      getAgentExitCode(Object.assign(new Error('bad hash'), { code: 'INTEGRITY_ERROR' }))
    ).toBe(AGENT_EXIT_CODES.VERIFICATION_FAILED);
  });

  it('maps unknown failures to exit code 1', () => {
    expect(getAgentExitCode(new Error('boom'))).toBe(AGENT_EXIT_CODES.FAILURE);
  });
}

describe('agent protocol session — stdout', defineAgentSessionStdoutTests);
describe('agent protocol session — stderr', defineAgentSessionErrorTests);
describe('getAgentExitCode', defineAgentExitCodeTests);
