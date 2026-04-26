/**
 * Interactive store wizard — guided flow for storing a file into git-cas.
 *
 * State machine with steps: filePath → slug → encryption → compression → chunking → confirm.
 * Renders within the TUI overlay system using the TEA architecture.
 */

import { boxSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
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
  if (key === 'enter' && state.filePath.length > 0) {
    const slug = deriveSlug(state.filePath);
    return { ...state, step: 'slug', slug };
  }
  if (key === 'backspace') {
    return { ...state, filePath: state.filePath.slice(0, -1) };
  }
  if (key.length === 1) {
    return { ...state, filePath: state.filePath + key };
  }
  return state;
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleSlugKey(state, key) {
  if (key === 'enter' && state.slug.length > 0) {
    return { ...state, step: 'encryption', selectIndex: ENCRYPTION_OPTIONS.indexOf(state.encryption) };
  }
  if (key === 'backspace') {
    return { ...state, slug: state.slug.slice(0, -1) };
  }
  if (key.length === 1) {
    return { ...state, slug: state.slug + key };
  }
  return state;
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleEncryptionKey(state, key) {
  if (key === 'enter') {
    const encryption = /** @type {'none' | 'passphrase' | 'convergent'} */ (ENCRYPTION_OPTIONS[state.selectIndex]);
    if (encryption === 'passphrase') {
      return { ...state, encryption, step: 'compression', selectIndex: 0 };
    }
    return { ...state, encryption, step: 'compression', selectIndex: 0 };
  }
  if (key === 'j' || key === 'down') {
    return { ...state, selectIndex: Math.min(state.selectIndex + 1, ENCRYPTION_OPTIONS.length - 1) };
  }
  if (key === 'k' || key === 'up') {
    return { ...state, selectIndex: Math.max(state.selectIndex - 1, 0) };
  }
  return state;
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleCompressionKey(state, key) {
  if (key === 'enter') {
    return { ...state, step: 'chunking', selectIndex: CHUNKING_OPTIONS.indexOf(state.chunking) };
  }
  if (key === 'space' || key === 'j' || key === 'k') {
    return { ...state, compression: !state.compression };
  }
  return state;
}

/**
 * @param {StoreWizardState} state
 * @param {string} key
 * @returns {StoreWizardState}
 */
function handleChunkingKey(state, key) {
  if (key === 'enter') {
    const chunking = /** @type {'whole' | 'fixed' | 'cdc'} */ (CHUNKING_OPTIONS[state.selectIndex]);
    return { ...state, chunking, step: 'confirm' };
  }
  if (key === 'j' || key === 'down') {
    return { ...state, selectIndex: Math.min(state.selectIndex + 1, CHUNKING_OPTIONS.length - 1) };
  }
  if (key === 'k' || key === 'up') {
    return { ...state, selectIndex: Math.max(state.selectIndex - 1, 0) };
  }
  return state;
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

/**
 * @param {number} index
 * @param {string[]} options
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderSelectList(index, options, ctx) {
  return options.map((opt, i) => {
    const indicator = i === index ? '▸' : ' ';
    const tone = i === index ? 'primary' : 'secondary';
    return `${indicator} ${themeText(ctx, opt, { tone })}`;
  }).join('\n');
}

/**
 * @param {BijouContext} ctx
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
function fieldLine(ctx, label, value) {
  return `${themeText(ctx, label, { tone: 'accent' })} ${themeText(ctx, value || '-', { tone: 'primary' })}`;
}

/**
 * Render the wizard overlay surface.
 *
 * @param {StoreWizardState} state
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
export function renderWizardSurface(state, opts) {
  const panelWidth = Math.max(36, Math.min(60, opts.width - 4));
  const innerWidth = Math.max(1, panelWidth - 2);
  const body = renderWizardBody(state, opts.ctx, innerWidth);
  const lines = body.split('\n');
  const panelHeight = Math.max(8, Math.min(lines.length + 4, opts.height));
  const innerHeight = Math.max(1, panelHeight - 2);
  const content = parseAnsiToSurface(body, innerWidth, innerHeight);
  return boxSurface(content, {
    ctx: opts.ctx,
    title: `Store  [${stepLabel(state.step)}]`,
    width: panelWidth,
    height: panelHeight,
  });
}

/**
 * @param {WizardStep} step
 * @returns {string}
 */
function stepLabel(step) {
  const labels = {
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
  return labels[step] ?? step;
}

/**
 * @param {StoreWizardState} state
 * @param {BijouContext} ctx
 * @param {number} _width
 * @returns {string}
 */
function renderWizardBody(state, ctx, _width) {
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
  const lines = [];
  if (state.step === 'filePath') {
    lines.push(themeText(ctx, 'File path:', { tone: 'accent' }));
    lines.push(`${state.filePath}\u2588`);
    lines.push('');
    lines.push(themeText(ctx, 'Type the file path, then press enter.', { tone: 'subdued' }));
  } else if (state.step === 'slug') {
    lines.push(themeText(ctx, 'Slug name:', { tone: 'accent' }));
    lines.push(`${state.slug}\u2588`);
    lines.push('');
    lines.push(themeText(ctx, 'Edit the slug, then press enter.', { tone: 'subdued' }));
  } else if (state.step === 'encryption') {
    lines.push(themeText(ctx, 'Encryption:', { tone: 'accent' }));
    lines.push(renderSelectList(state.selectIndex, ENCRYPTION_OPTIONS, ctx));
    lines.push('');
    lines.push(themeText(ctx, 'j/k to move, enter to select.', { tone: 'subdued' }));
  } else if (state.step === 'compression') {
    lines.push(themeText(ctx, 'Compression (gzip):', { tone: 'accent' }));
    const toggle = state.compression ? '[x] enabled' : '[ ] disabled';
    lines.push(themeText(ctx, toggle, { tone: 'primary' }));
    lines.push('');
    lines.push(themeText(ctx, 'space to toggle, enter to continue.', { tone: 'subdued' }));
  } else if (state.step === 'chunking') {
    lines.push(themeText(ctx, 'Chunking strategy:', { tone: 'accent' }));
    lines.push(renderSelectList(state.selectIndex, CHUNKING_OPTIONS, ctx));
    lines.push('');
    lines.push(themeText(ctx, 'j/k to move, enter to select.', { tone: 'subdued' }));
  }
  return lines.join('\n');
}

/**
 * @param {StoreWizardState} state
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderConfirmBody(state, ctx) {
  const lines = [
    themeText(ctx, 'Review and confirm:', { tone: 'accent', bold: true }),
    '',
    fieldLine(ctx, 'File:', state.filePath),
    fieldLine(ctx, 'Slug:', state.slug),
    fieldLine(ctx, 'Encryption:', state.encryption),
    fieldLine(ctx, 'Compression:', state.compression ? 'gzip' : 'none'),
    fieldLine(ctx, 'Chunking:', state.chunking),
    '',
    themeText(ctx, 'enter/y to store, n/backspace to restart.', { tone: 'subdued' }),
  ];
  return lines.join('\n');
}
