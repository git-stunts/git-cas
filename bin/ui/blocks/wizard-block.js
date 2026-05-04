/**
 * WizardBlock — reusable step-based wizard infrastructure.
 *
 * Provides generic step types (text input, select list, toggle, confirm),
 * step navigation, and rendering helpers. Application wizards define
 * their steps declaratively and delegate key handling + rendering here.
 */

import { boxSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { themeText } from '../theme.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').Surface} Surface
 */

/**
 * @typedef {Object} WizardStepDef
 * @property {string} id - Step identifier.
 * @property {string} label - Human-readable step label.
 * @property {'text' | 'select' | 'toggle' | 'confirm'} type - Step input type.
 * @property {string} [prompt] - Prompt text shown above the input.
 * @property {string} [hint] - Help text shown below the input.
 * @property {string[]} [options] - Options for 'select' type.
 */

const WIZARD_MIN_WIDTH = 36;
const WIZARD_MAX_WIDTH = 60;
const WIZARD_MARGIN = 4;
const WIZARD_MIN_HEIGHT = 8;
const WIZARD_PADDING = 4;

/**
 * Render a select list with focus indicator.
 *
 * @param {number} focusIndex
 * @param {string[]} options
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderSelectList(focusIndex, options, ctx) {
  return options.map((opt, i) => {
    const indicator = i === focusIndex ? '\u25b8' : ' ';
    const tone = i === focusIndex ? 'primary' : 'secondary';
    return `${indicator} ${themeText(ctx, opt, { tone })}`;
  }).join('\n');
}

/**
 * Render a text input field with cursor.
 *
 * @param {string} value
 * @returns {string}
 */
export function renderTextInput(value) {
  return `${value}\u2588`;
}

/**
 * Render a toggle field.
 *
 * @param {boolean} value
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderToggle(value, ctx) {
  const toggle = value ? '[x] enabled' : '[ ] disabled';
  return themeText(ctx, toggle, { tone: 'primary' });
}

/**
 * Render a labeled key-value line.
 *
 * @param {BijouContext} ctx
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
export function renderFieldLine(ctx, label, value) {
  return `${themeText(ctx, label, { tone: 'accent' })} ${themeText(ctx, value || '-', { tone: 'primary' })}`;
}

/**
 * Render a wizard panel surface with title and step indicator.
 *
 * Uses parseAnsiToSurface for height measurement instead of
 * string line counting.
 *
 * @param {Object} opts
 * @param {string} opts.title - Panel title with step indicator.
 * @param {string} opts.body - Rendered body content.
 * @param {number} opts.screenWidth - Available screen width.
 * @param {number} opts.screenHeight - Available screen height.
 * @param {BijouContext} opts.ctx
 * @returns {Surface}
 */
export function renderWizardPanel(opts) {
  const panelWidth = Math.max(WIZARD_MIN_WIDTH, Math.min(WIZARD_MAX_WIDTH, opts.screenWidth - WIZARD_MARGIN));
  const innerWidth = Math.max(1, panelWidth - 2);
  const bodySurface = parseAnsiToSurface(opts.body, innerWidth, 999);
  const panelHeight = Math.max(WIZARD_MIN_HEIGHT, Math.min(bodySurface.height + WIZARD_PADDING, opts.screenHeight));
  const innerHeight = Math.max(1, panelHeight - 2);
  const content = parseAnsiToSurface(opts.body, innerWidth, innerHeight);
  return boxSurface(content, {
    ctx: opts.ctx,
    title: opts.title,
    width: panelWidth,
    height: panelHeight,
  });
}

/**
 * Handle key events for a select-list step.
 *
 * @param {number} selectIndex - Current focus index.
 * @param {number} optionCount - Total options.
 * @param {string} key - Key pressed.
 * @returns {{ selectIndex: number, confirmed: boolean }}
 */
export function handleSelectKey(selectIndex, optionCount, key) {
  if (key === 'enter') {
    return { selectIndex, confirmed: true };
  }
  if (key === 'j' || key === 'down') {
    return { selectIndex: Math.min(selectIndex + 1, optionCount - 1), confirmed: false };
  }
  if (key === 'k' || key === 'up') {
    return { selectIndex: Math.max(selectIndex - 1, 0), confirmed: false };
  }
  return { selectIndex, confirmed: false };
}

/**
 * Handle key events for a text-input step.
 *
 * @param {string} value - Current input value.
 * @param {string} key - Key pressed.
 * @returns {{ value: string, confirmed: boolean }}
 */
export function handleTextKey(value, key) {
  if (key === 'enter' && value.length > 0) {
    return { value, confirmed: true };
  }
  if (key === 'backspace') {
    return { value: value.slice(0, -1), confirmed: false };
  }
  if (key.length === 1) {
    return { value: value + key, confirmed: false };
  }
  return { value, confirmed: false };
}

/**
 * Handle key events for a toggle step.
 *
 * @param {boolean} value - Current toggle value.
 * @param {string} key - Key pressed.
 * @returns {{ value: boolean, confirmed: boolean }}
 */
export function handleToggleKey(value, key) {
  if (key === 'enter') {
    return { value, confirmed: true };
  }
  if (key === 'space' || key === 'j' || key === 'k') {
    return { value: !value, confirmed: false };
  }
  return { value, confirmed: false };
}
