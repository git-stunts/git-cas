/**
 * @param {unknown} value
 * @returns {value is string}
 */
export default function isCanonicalUtcTimestamp(value) {
  return (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
