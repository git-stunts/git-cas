/**
 * Abstract port for non-mutating, repository-wide Git object inspection.
 * @abstract
 */
export default class RepositoryInspectionPort {
  /** @returns {AsyncIterable<{ oid: string, type: string, logicalBytes: number, physicalBytes: number }>} */
  iterateObjects() {
    throw new Error('Not implemented');
  }

  /** @returns {AsyncIterable<string>} */
  iterateReachableObjectIds() {
    throw new Error('Not implemented');
  }

  /**
   * @param {{ expiresBefore: string }} _options
   * @returns {AsyncIterable<{ oid: string, type: string }>}
   */
  iteratePrunableObjects(_options) {
    throw new Error('Not implemented');
  }

  /** @returns {AsyncIterable<{ ref: string, oid: string }>} */
  iterateRefs() {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<number>} */
  async reachablePhysicalBytes() {
    throw new Error('Not implemented');
  }
}
