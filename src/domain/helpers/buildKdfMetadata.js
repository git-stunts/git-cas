/**
 * Builds the KDF metadata object for vault/manifest encryption metadata.
 *
 * @param {Buffer} salt - KDF salt.
 * @param {{ algorithm: string, keyLength: number, iterations?: number, cost?: number, blockSize?: number, parallelization?: number }} params - KDF parameters.
 * @returns {{ algorithm: string, salt: string, keyLength: number, iterations?: number, cost?: number, blockSize?: number, parallelization?: number }}
 */
export default function buildKdfMetadata(salt, params) {
  return {
    algorithm: params.algorithm,
    salt: salt.toString('base64'),
    ...('iterations' in params && { iterations: params.iterations }),
    ...('cost' in params && { cost: params.cost }),
    ...('blockSize' in params && { blockSize: params.blockSize }),
    ...('parallelization' in params && { parallelization: params.parallelization }),
    keyLength: params.keyLength,
  };
}
