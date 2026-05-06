import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_OS_KEYCHAIN_ACCOUNT,
  hasExplicitPassphraseSource,
  hasPassphraseSource,
  inlinePassphraseWarnings,
  resolveOsKeychainPassphrase,
  resolvePassphrase,
  validatePassphraseSources,
  warnInlinePassphraseArgs,
} from '../../../bin/passphrase-source.js';

function makeImportVault(getSecret, assertAccount = () => {}) {
  return vi.fn(async () =>
    class MockVault {
      constructor(options) {
        assertAccount(options);
      }

      getSecret(...args) {
        return getSecret(...args);
      }
    }
  );
}

describe('validatePassphraseSources', () => {
  it('accepts one explicit inline passphrase source', () => {
    expect(() => validatePassphraseSources({ vaultPassphrase: 'secret' })).not.toThrow();
  });

  it('rejects conflicting inline and file passphrase sources', () => {
    expect(() =>
      validatePassphraseSources({ vaultPassphrase: 'secret', vaultPassphraseFile: '/tmp/pass' })
    ).toThrow(
      'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target'
    );
  });

  it('rejects conflicting inline and OS-keychain passphrase sources', () => {
    expect(() =>
      validatePassphraseSources({ vaultPassphrase: 'secret', osKeychainTarget: 'demo/passphrase' })
    ).toThrow(
      'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target'
    );
  });

  it('rejects an OS-keychain account without a target', () => {
    expect(() => validatePassphraseSources({ osKeychainAccount: 'custom' })).toThrow(
      'Provide --os-keychain-target when using --os-keychain-account'
    );
  });
});

describe('hasPassphraseSource', () => {
  it('counts the OS-keychain target as a passphrase source', () => {
    expect(hasPassphraseSource({ osKeychainTarget: 'demo/passphrase' }, {})).toBe(true);
  });

  it('treats the OS-keychain target as an explicit source', () => {
    expect(hasExplicitPassphraseSource({ osKeychainTarget: 'demo/passphrase' })).toBe(true);
  });
});

describe('inline passphrase warnings', () => {
  it('warns for inline human CLI passphrase flags', () => {
    expect(inlinePassphraseWarnings({
      vaultPassphrase: 'secret',
      oldPassphrase: 'old-secret',
      newPassphrase: 'new-secret',
    })).toEqual([
      'warning: --vault-passphrase exposes secrets through shell history and process listings; prefer --vault-passphrase-file -, GIT_CAS_PASSPHRASE, or --os-keychain-target',
      'warning: --old-passphrase exposes secrets through shell history and process listings; prefer --old-passphrase-file -',
      'warning: --new-passphrase exposes secrets through shell history and process listings; prefer --new-passphrase-file -',
    ]);
  });

  it('does not warn for file, env, or OS-keychain passphrase sources', () => {
    expect(inlinePassphraseWarnings({
      vaultPassphraseFile: '-',
      osKeychainTarget: 'demo/passphrase',
    })).toEqual([]);
  });

  it('writes each inline passphrase warning to stderr', () => {
    const write = vi.fn();

    warnInlinePassphraseArgs({ vaultPassphrase: 'secret' }, write);

    expect(write).toHaveBeenCalledWith(
      'warning: --vault-passphrase exposes secrets through shell history and process listings; prefer --vault-passphrase-file -, GIT_CAS_PASSPHRASE, or --os-keychain-target\n'
    );
  });
});

describe('resolveOsKeychainPassphrase', () => {
  it('uses the default account when one is not provided', async () => {
    const getSecret = vi.fn(() => 'stored-secret');
    const importVault = makeImportVault(
      getSecret,
      (options) => {
        expect(options).toEqual({ account: DEFAULT_OS_KEYCHAIN_ACCOUNT });
      }
    );

    await expect(
      resolveOsKeychainPassphrase({ target: 'demo/passphrase', importVault })
    ).resolves.toBe('stored-secret');
    expect(getSecret).toHaveBeenCalledWith({ target: 'demo/passphrase' });
  });

  it('awaits the async OS-keychain secret lookup', async () => {
    const getSecret = vi.fn(async () => 'stored-secret');
    const importVault = makeImportVault(getSecret);

    await expect(
      resolveOsKeychainPassphrase({ target: 'demo/passphrase', importVault })
    ).resolves.toBe('stored-secret');
  });

  it('throws when the OS-keychain secret is missing', async () => {
    const importVault = makeImportVault(() => undefined);

    await expect(
      resolveOsKeychainPassphrase({ target: 'demo/passphrase', importVault })
    ).rejects.toThrow('OS keychain secret not found for account "git-cas" target "demo/passphrase"');
  });

  it('throws when the OS-keychain secret is empty', async () => {
    const importVault = makeImportVault(() => '   ');

    await expect(
      resolveOsKeychainPassphrase({ target: 'demo/passphrase', importVault })
    ).rejects.toThrow(
      'OS keychain secret for account "git-cas" target "demo/passphrase" must not be empty'
    );
  });
});

describe('resolvePassphrase', () => {
  it('prefers the OS keychain target before env and prompt', async () => {
    const promptPassphrase = vi.fn();
    const readPassphraseFile = vi.fn();
    const resolveFromKeychain = vi.fn(async () => 'keychain-secret');

    await expect(
      resolvePassphrase(
        { osKeychainTarget: 'demo/passphrase' },
        {},
        {
          env: { GIT_CAS_PASSPHRASE: 'env-secret' },
          stdin: { isTTY: true },
          promptPassphrase,
          readPassphraseFile,
          resolveOsKeychainPassphrase: resolveFromKeychain,
        }
      )
    ).resolves.toBe('keychain-secret');

    expect(resolveFromKeychain).toHaveBeenCalledWith({
      target: 'demo/passphrase',
      account: undefined,
    });
    expect(readPassphraseFile).not.toHaveBeenCalled();
    expect(promptPassphrase).not.toHaveBeenCalled();
  });

  it('prompts only when no file, inline, OS-keychain, or env source exists', async () => {
    const promptPassphrase = vi.fn(async () => 'prompt-secret');

    await expect(
      resolvePassphrase({}, { confirm: true }, { env: {}, stdin: { isTTY: true }, promptPassphrase })
    ).resolves.toBe('prompt-secret');

    expect(promptPassphrase).toHaveBeenCalledWith({ confirm: true });
  });
});
