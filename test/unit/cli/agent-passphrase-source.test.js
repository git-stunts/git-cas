import { describe, expect, it, vi } from 'vitest';
import {
  resolveAgentPassphraseSource,
  validateAgentPassphraseSource,
} from '../../../bin/agent/passphrase-source.js';

function invalidInput(message) {
  const err = new Error(message);
  err.code = 'INVALID_INPUT';
  return err;
}

function buildValidationOptions(overrides = {}) {
  return {
    inlineValue: undefined,
    fileValue: undefined,
    osKeychainTarget: undefined,
    osKeychainAccount: undefined,
    inlineFlag: '--vault-passphrase',
    fileFlag: '--vault-passphrase-file',
    keychainTargetFlag: '--os-keychain-target',
    keychainAccountFlag: '--os-keychain-account',
    label: 'vault passphrase source',
    errorFactory: invalidInput,
    ...overrides,
  };
}

function defineAgentPassphraseValidationTests() {
  it('accepts a single OS-keychain source', () => {
    expect(() => validateAgentPassphraseSource(buildValidationOptions({
      osKeychainTarget: 'demo/passphrase',
    }))).not.toThrow();
  });

  it('rejects multiple explicit sources', () => {
    expect(() => validateAgentPassphraseSource(buildValidationOptions({
      inlineValue: 'secret',
      osKeychainTarget: 'demo/passphrase',
    }))).toThrow(
      'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target'
    );
  });

  it('requires a target when an account is provided', () => {
    expect(() => validateAgentPassphraseSource(buildValidationOptions({
      osKeychainAccount: 'demo-account',
    }))).toThrow('Provide --os-keychain-target when using --os-keychain-account');
  });

  it('rejects an empty OS-keychain target', () => {
    expect(() => validateAgentPassphraseSource(buildValidationOptions({
      osKeychainTarget: '   ',
    }))).toThrow('OS keychain target must not be empty');
  });
}

function buildResolutionOptions(overrides = {}) {
  return {
    label: 'Passphrase',
    inlineValue: undefined,
    fileValue: undefined,
    osKeychainTarget: undefined,
    osKeychainAccount: undefined,
    requestSource: undefined,
    resolveInlinePassphrase: vi.fn(),
    readPassphraseFile: vi.fn(),
    resolveOsKeychainPassphrase: vi.fn(),
    errorFactory: invalidInput,
    ...overrides,
  };
}

function defineAgentPassphraseResolutionTests() {
  it('resolves OS-keychain passphrases with the default account', async () => {
    const resolveOsKeychainPassphraseFn = vi.fn().mockResolvedValue('secret-from-keychain');

    await expect(resolveAgentPassphraseSource(buildResolutionOptions({
      osKeychainTarget: 'demo/passphrase',
      resolveOsKeychainPassphrase: resolveOsKeychainPassphraseFn,
    }))).resolves.toBe('secret-from-keychain');

    expect(resolveOsKeychainPassphraseFn).toHaveBeenCalledWith({
      target: 'demo/passphrase',
      account: undefined,
    });
  });

  it('forwards an explicit OS-keychain account', async () => {
    const resolveOsKeychainPassphraseFn = vi.fn().mockResolvedValue('secret-from-keychain');

    await resolveAgentPassphraseSource(buildResolutionOptions({
      osKeychainTarget: 'demo/passphrase',
      osKeychainAccount: 'git-cas-demo',
      resolveOsKeychainPassphrase: resolveOsKeychainPassphraseFn,
    }));

    expect(resolveOsKeychainPassphraseFn).toHaveBeenCalledWith({
      target: 'demo/passphrase',
      account: 'git-cas-demo',
    });
  });

  it('rejects stdin conflicts before reading a passphrase file', async () => {
    const readPassphraseFile = vi.fn();

    await expect(resolveAgentPassphraseSource(buildResolutionOptions({
      fileValue: '-',
      requestSource: '-',
      readPassphraseFile,
    }))).rejects.toThrow('Cannot read both request payload and passphrase from stdin');

    expect(readPassphraseFile).not.toHaveBeenCalled();
  });
}

describe('agent passphrase source validation', defineAgentPassphraseValidationTests);
describe('agent passphrase source resolution', defineAgentPassphraseResolutionTests);
