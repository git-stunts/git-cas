import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assignPositionals: vi.fn(),
  createCas: vi.fn(),
  inspectVaultHealth: vi.fn(),
  normalizeInputAliases: vi.fn((input) => input),
  parseAgentInput: vi.fn(),
  readAgentPassphraseFile: vi.fn(),
  resolveAgentDiagnosticEncryptionKey: vi.fn(),
  resolveAgentStoreEncryptionKey: vi.fn(),
  selectStartInput: vi.fn((values) => values),
  writeAgentStart: vi.fn(),
}));

vi.mock('../../../bin/ui/vault-report.js', () => ({
  inspectVaultHealth: mocks.inspectVaultHealth,
}));

vi.mock('../../../bin/credentials.js', () => ({
  resolveAgentDiagnosticEncryptionKey: mocks.resolveAgentDiagnosticEncryptionKey,
  resolveAgentStoreEncryptionKey: mocks.resolveAgentStoreEncryptionKey,
}));

vi.mock('../../../bin/agent/input.js', () => ({
  assignPositionals: mocks.assignPositionals,
  createCas: mocks.createCas,
  invalidInput: (message) => Object.assign(new Error(message), { code: 'INVALID_INPUT' }),
  normalizeInputAliases: mocks.normalizeInputAliases,
  parseAgentInput: mocks.parseAgentInput,
  readAgentPassphraseFile: mocks.readAgentPassphraseFile,
  selectStartInput: mocks.selectStartInput,
  writeAgentStart: mocks.writeAgentStart,
}));

const { default: doctorCommand } = await import('../../../bin/agent/commands/doctor.js');

describe('agent doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves vault credentials and passes the key to doctor inspection', async () => {
    const cas = {};
    const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const stdin = { isTTY: false };
    const session = {};
    mocks.parseAgentInput.mockResolvedValue({
      values: { cwd: '.', keyFile: 'key.bin' },
      positionals: [],
      requestSource: undefined,
    });
    mocks.createCas.mockResolvedValue(cas);
    mocks.resolveAgentDiagnosticEncryptionKey.mockResolvedValue(encryptionKey);
    mocks.inspectVaultHealth.mockResolvedValue({ status: 'ok' });

    const result = await doctorCommand(['--key-file', 'key.bin'], stdin, session);

    expect(result.exitCode).toBe(0);
    expect(mocks.resolveAgentDiagnosticEncryptionKey).toHaveBeenCalledWith(
      cas,
      expect.objectContaining({ keyFile: 'key.bin' }),
      expect.objectContaining({ stdin }),
    );
    expect(mocks.resolveAgentStoreEncryptionKey).not.toHaveBeenCalled();
    expect(mocks.inspectVaultHealth).toHaveBeenCalledWith(cas, { encryptionKey });
  });
});
