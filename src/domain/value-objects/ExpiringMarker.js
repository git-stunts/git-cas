import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import Oid from './Oid.js';
import RetentionWitness from './RetentionWitness.js';

const DIGEST = /^[0-9a-f]{64}$/;

/** Immutable evidence for one live replay marker. */
export default class ExpiringMarker {
  constructor({ keyDigest, expiresAt, createdAt, generation, evidence }) {
    if (typeof keyDigest !== 'string' || !DIGEST.test(keyDigest)) {
      throw invalid('Expiring marker key digest is invalid', { keyDigest });
    }
    assertCanonicalTimestamp(createdAt, {
      invalid,
      message: 'Expiring marker creation time must be canonical UTC',
    });
    assertCanonicalTimestamp(expiresAt, {
      invalid,
      message: 'Expiring marker expiry must be canonical UTC',
    });
    if (expiresAt <= createdAt) {
      throw invalid('Expiring marker expiry must follow its creation time', {
        createdAt,
        expiresAt,
      });
    }
    const normalizedGeneration = Oid.from(generation).toString();
    const normalizedEvidence = evidence instanceof RetentionWitness
      ? evidence
      : new RetentionWitness(evidence);
    if (normalizedEvidence.policy !== 'pinned' ||
        normalizedEvidence.root.kind !== 'expiring-set' ||
        normalizedEvidence.root.generation !== normalizedGeneration ||
        normalizedEvidence.handle.kind !== 'page') {
      throw invalid('Expiring marker evidence is inconsistent', {
        generation: normalizedGeneration,
        evidence: normalizedEvidence.toJSON(),
      });
    }

    this.version = 1;
    this.keyDigest = keyDigest;
    this.expiresAt = expiresAt;
    this.createdAt = createdAt;
    this.generation = normalizedGeneration;
    this.evidence = normalizedEvidence;
    Object.freeze(this);
  }

  toJSON() {
    return {
      version: this.version,
      keyDigest: this.keyDigest,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      generation: this.generation,
      evidence: this.evidence.toJSON(),
    };
  }
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.EXPIRING_SET_MARKER_INVALID, meta);
}
