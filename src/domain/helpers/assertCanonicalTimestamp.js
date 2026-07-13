/**
 * @param {unknown} value
 * @param {object} options
 * @param {(message: string, meta: object) => Error} options.invalid
 * @param {string} options.message
 */
export default function assertCanonicalTimestamp(value, { invalid, message }) {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw invalid(message, { observedAt: value });
  }
}
