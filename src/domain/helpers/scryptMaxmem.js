/**
 * Compute a conservative `maxmem` budget for Node-compatible scrypt calls.
 *
 * Mirrors the runtime formula currently required by the Node, Bun, and Web
 * Crypto fallback derive paths.
 *
 * @param {{
 *   cost: number,
 *   blockSize: number,
 *   parallelization: number,
 *   keyLength: number,
 * }} options
 * @returns {number}
 */
export default function scryptMaxmem({ cost, blockSize, parallelization, keyLength }) {
  return (
    (128 * cost * blockSize) +
    (256 * blockSize * parallelization) +
    keyLength +
    (1024 * 1024)
  );
}
