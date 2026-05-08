import { inspectVaultHealth } from '../../ui/vault-report.js';
import {
  assignPositionals,
  createCas,
  parseAgentInput,
  selectStartInput,
  writeAgentStart,
} from '../input.js';
import { AGENT_EXIT_CODES } from '../protocol.js';

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @param {ReturnType<typeof import('../protocol.js').createAgentSession>} session
 * @returns {Promise<{ exitCode: number, data: Record<string, any> }>}
 */
export default async function doctorCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  writeAgentStart(session, selectStartInput(values, ['cwd']));

  const cas = await createCas(values.cwd || '.');
  const report = await inspectVaultHealth(cas);
  const exitCode =
    report.status === 'ok' ? AGENT_EXIT_CODES.SUCCESS : AGENT_EXIT_CODES.VERIFICATION_FAILED;

  return {
    exitCode,
    data: { report },
  };
}
