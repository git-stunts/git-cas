import { AGENT_EXIT_CODES, createAgentSession, getAgentExitCode } from './protocol.js';
import { executeAgentCommand } from './commands/index.js';

/**
 * @param {string[]} argv
 * @returns {{ command: string, args: string[] }}
 */
function resolveCommand(argv) {
  if (argv.length === 0) {
    return { command: 'agent', args: [] };
  }

  if (argv[0] === 'vault' || argv[0] === 'recipient') {
    if (!argv[1]) {
      return { command: argv[0], args: [] };
    }
    return { command: `${argv[0]}.${argv[1]}`, args: argv.slice(2) };
  }

  return { command: argv[0], args: argv.slice(1) };
}

/**
 * @param {string[]} argv
 * @param {{ stdout?: Pick<NodeJS.WriteStream, 'write'>, stderr?: Pick<NodeJS.WriteStream, 'write'>, stdin?: NodeJS.ReadStream }} [deps]
 * @returns {Promise<void>}
 */
export async function runAgentCli(
  argv,
  { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}
) {
  const { command, args } = resolveCommand(argv);
  const session = createAgentSession({ command, stdout, stderr });

  try {
    const outcome = await executeAgentCommand(command, args, { stdin, session });
    const exitCode = outcome.exitCode ?? AGENT_EXIT_CODES.SUCCESS;
    process.exitCode = exitCode;
    session.writeResult(outcome.data);
    session.writeEnd({ ok: exitCode === AGENT_EXIT_CODES.SUCCESS, exitCode });
  } catch (err) {
    const exitCode = getAgentExitCode(err);
    process.exitCode = exitCode;
    if (err instanceof Error && err.code === 'NEEDS_INPUT') {
      session.writeNeedsInput(err);
    } else {
      session.writeError(err);
    }
    session.writeEnd({ ok: false, exitCode });
  }
}
