/**
 * Interactive store wizard — guided flow for storing a file into git-cas.
 *
 * State machine with steps: filePath → slug → encryption → compression → chunking → confirm.
 * Renders within the TUI overlay system using the TEA architecture.
 * Delegates generic step handling and rendering to WizardBlock.
 */

import {
  handleSelectKey, handleTextKey, handleToggleKey,
  renderFieldLine, renderSelectList, renderTextInput, renderToggle,
  renderWizardPanel,
} from './blocks/wizard-block.js';
import { themeText } from './theme.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').Surface} Surface
 */

/**
 * @typedef {'filePath' | 'slug' | 'encryption' | 'compression' | 'chunking' | 'confirm' | 'storing' | 'done' | 'error'} WizardStep
 */

/**
 * @typedef {Object} StoreWizardState
 * @property {WizardStep} step
 * @property {string} filePath
 * @property {string} slug
 * @property {'none' | 'passphrase' | 'convergent'} encryption
 * @property {string} passphrase
 * @property {boolean} passphraseVisible
 * @property {boolean} compression
 * @property {'whole' | 'fixed' | 'cdc'} chunking
 * @property {number} selectIndex
 * @property {string | null} error
 * @property {string | null} resultSlug
 */

const ENCRYPTION_OPTIONS = ['none', 'passphrase', 'convergent'];
const CHUNKING_OPTIONS = ['whole', 'fixed', 'cdc'];

/**
 * Create a fresh wizard state.
 *
 * @returns {StoreWizardState}
 */
export function createWizardState() {
  return {
    step: 'filePath',
    filePath: '',
    slug: '',
    encryption: 'none',
    passphrase: '',
    passphraseVisible: false,
    compression: false,
    chunking: 'cdc',
    selectIndex: 0,
    error: null,
    resultSlug: null,
  };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleFilePathKey(state, key) {
  const result = handleTextKey(state.filePath, key);
  if (result.confirmed) {
    return { ...state, filePath: result.value, step: 'slug', slug: deriveSlug(result.value) };
  }
  return { ...state, filePath: result.value };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleSlugKey(state, key) {
  const result = handleTextKey(state.slug, key);
  if (result.confirmed) {
    return { ...state, slug: result.value, step: 'encryption', selectIndex: ENCRYPTION_OPTIONS.indexOf(state.encryption) };
  }
  return { ...state, slug: result.value };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleEncryptionKey(state, key) {
  const result = handleSelectKey(state.selectIndex, ENCRYPTION_OPTIONS.length, key);
  if (result.confirmed) {
    const encryption = /** @type {'none' | 'passphrase' | 'convergent'} */ (ENCRYPTION_OPTIONS[result.selectIndex]);
    return { ...state, encryption, selectIndex: 0, step: 'compression' };
  }
  return { ...state, selectIndex: result.selectIndex };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleCompressionKey(state, key) {
  const result = handleToggleKey(state.compression, key);
  if (result.confirmed) {
    return { ...state, compression: result.value, step: 'chunking', selectIndex: CHUNKING_OPTIONS.indexOf(state.chunking) };
  }
  return { ...state, compression: result.value };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleChunkingKey(state, key) {
  const result = handleSelectKey(state.selectIndex, CHUNKING_OPTIONS.length, key);
  if (result.confirmed) {
    const chunking = /** @type {'whole' | 'fixed' | 'cdc'} */ (CHUNKING_OPTIONS[result.selectIndex]);
    return { ...state, chunking, step: 'confirm' };
  }
  return { ...state, selectIndex: result.selectIndex };
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleConfirmKey(state, key) {
  if (key === 'enter' || key === 'y') {
    return { ...state, step: 'storing' };
  }
  if (key === 'n' || key === 'backspace') {
    return { ...state, step: 'filePath' };
  }
  return state;
}

/** @type {Record<string, (state: StoreWizardState, key: string) => StoreWizardState>} */
const stepHandlers = {
  filePath: handleFilePathKey,
  slug: handleSlugKey,
  encryption: handleEncryptionKey,
  compression: handleCompressionKey,
  chunking: handleChunkingKey,
  confirm: handleConfirmKey,
};

/**
 * Handle a key press within the wizard.
 *
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
export function wizardHandleKey(state, key) {
  if (state.step === 'storing' || state.step === 'done') {
    return state;
  }
  if (key === 'escape') {
    return { ...state, step: 'error', error: 'Cancelled' };
  }
  return stepHandlers[state.step]?.(state, key) ?? state;
}

/**
 * Derive a slug from a file path.
 *
 * @param {string} filePath
 * @returns {string}
 */
function deriveSlug(filePath) {
  const name = filePath.split('/').pop() || filePath;
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

/** @type {Record<string, string>} */
const STEP_LABELS = {
  filePath: '1/6 File',
  slug: '2/6 Slug',
  encryption: '3/6 Encryption',
  compression: '4/6 Compression',
  chunking: '5/6 Chunking',
  confirm: '6/6 Confirm',
  storing: 'Storing...',
  done: 'Done',
  error: 'Error',
};

/**
 * Render the wizard overlay surface.
 *
 * @param {StoreWizardState} state
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
export function renderWizardSurface(state, opts) {
  return renderWizardPanel({
    title: `Store  [${STEP_LABELS[state.step] ?? state.step}]`,
    body: renderWizardBody(state, opts.ctx),
    screenWidth: opts.width,
    screenHeight: opts.height,
    ctx: opts.ctx,
  });
}

/**
 * @param {StoreWizardState} state
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderWizardBody(state, ctx) {
  if (state.step === 'error') {
    return themeText(ctx, state.error ?? 'Cancelled', { tone: 'danger' });
  }
  if (state.step === 'storing') {
    return themeText(ctx, `Storing ${state.slug}...`, { tone: 'info' });
  }
  if (state.step === 'done') {
    return themeText(ctx, `Stored ${state.resultSlug}`, { tone: 'accent' });
  }
  if (state.step === 'confirm') {
    return renderConfirmBody(state, ctx);
  }
  return renderStepBody(state, ctx);
}

/**
 * @param {StoreWizardState} state
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderStepBody(state, ctx) {
  /** @type {Record<string, () => string[]>} */
  const renderers = {
    filePath: () => [
      themeText(ctx, 'File path:', { tone: 'accent' }),
      renderTextInput(state.filePath),
      '',
      themeText(ctx, 'Type the file path, then press enter.', { tone: 'subdued' }),
    ],
    slug: () => [
      themeText(ctx, 'Slug name:', { tone: 'accent' }),
      renderTextInput(state.slug),
      '',
      themeText(ctx, 'Edit the slug, then press enter.', { tone: 'subdued' }),
    ],
    encryption: () => [
      themeText(ctx, 'Encryption:', { tone: 'accent' }),
      renderSelectList(state.selectIndex, ENCRYPTION_OPTIONS, ctx),
      '',
      themeText(ctx, 'j/k to move, enter to select.', { tone: 'subdued' }),
    ],
    compression: () => [
      themeText(ctx, 'Compression (gzip):', { tone: 'accent' }),
      renderToggle(state.compression, ctx),
      '',
      themeText(ctx, 'space to toggle, enter to continue.', { tone: 'subdued' }),
    ],
    chunking: () => [
      themeText(ctx, 'Chunking strategy:', { tone: 'accent' }),
      renderSelectList(state.selectIndex, CHUNKING_OPTIONS, ctx),
      '',
      themeText(ctx, 'j/k to move, enter to select.', { tone: 'subdued' }),
    ],
  };
  const render = renderers[state.step];
  return render ? render().join('\n') : '';
}

/**
 * @param {StoreWizardState} state
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderConfirmBody(state, ctx) {
  return [
    themeText(ctx, 'Review and confirm:', { tone: 'accent', bold: true }),
    '',
    renderFieldLine(ctx, 'File:', state.filePath),
    renderFieldLine(ctx, 'Slug:', state.slug),
    renderFieldLine(ctx, 'Encryption:', state.encryption),
    renderFieldLine(ctx, 'Compression:', state.compression ? 'gzip' : 'none'),
    renderFieldLine(ctx, 'Chunking:', state.chunking),
    '',
    themeText(ctx, 'enter/y to store, n/backspace to restart.', { tone: 'subdued' }),
  ].join('\n');
}
