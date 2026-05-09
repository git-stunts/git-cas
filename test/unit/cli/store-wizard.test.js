import { describe, expect, it } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import {
  createWizardState,
  renderWizardSurface,
  wizardHandleKey,
} from '../../../bin/ui/store-wizard.js';
import { makeCtx } from './_testContext.js';

function selectOption(state, optionIndex) {
  let next = state;
  for (let index = 0; index < optionIndex; index += 1) {
    next = wizardHandleKey(next, 'j');
  }
  return wizardHandleKey(next, 'enter');
}

function typeText(state, text) {
  let next = state;
  for (const char of text) {
    next = wizardHandleKey(next, char);
  }
  return wizardHandleKey(next, 'enter');
}

describe('store wizard state machine', () => {
  it('collects a passphrase before leaving passphrase encryption selection', () => {
    const withFile = typeText(createWizardState(), './secret.bin');
    const withSlug = typeText(withFile, 'secret');
    const selectedPassphrase = selectOption(withSlug, 1);

    expect(selectedPassphrase.step).toBe('passphrase');

    const withPassphrase = typeText(selectedPassphrase, 'secret-passphrase');

    expect(withPassphrase.passphrase).toBe('secret-passphrase');
    expect(withPassphrase.step).toBe('compression');
  });

  it('collects a passphrase before leaving convergent encryption selection', () => {
    const withFile = typeText(createWizardState(), './secret.bin');
    const withSlug = typeText(withFile, 'secret');
    const selectedConvergent = selectOption(withSlug, 2);

    expect(selectedConvergent.step).toBe('passphrase');

    const withPassphrase = typeText(selectedConvergent, 'dedupe-passphrase');

    expect(withPassphrase.encryption).toBe('convergent');
    expect(withPassphrase.passphrase).toBe('dedupe-passphrase');
    expect(withPassphrase.step).toBe('compression');
  });

  it('keeps step numbering contiguous when encryption is skipped', () => {
    const ctx = makeCtx();
    const state = {
      ...createWizardState(),
      step: 'compression',
      encryption: 'none',
    };

    const surface = renderWizardSurface(state, { width: 80, height: 24, ctx });

    expect(surfaceToString(surface, ctx.style)).toContain('Store  [4/6 Compression]');
  });
});
