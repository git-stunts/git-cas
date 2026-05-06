import CasError from './CasError.js';
import CannotRemoveLastRecipientError from './CannotRemoveLastRecipientError.js';
import DekUnwrapFailedError from './DekUnwrapFailedError.js';
import GitError from './GitError.js';
import IntegrityError from './IntegrityError.js';
import InvalidChunkingStrategyError from './InvalidChunkingStrategyError.js';
import InvalidOidError from './InvalidOidError.js';
import InvalidOptionsError from './InvalidOptionsError.js';
import ManifestIntegrityError from './ManifestIntegrityError.js';
import ManifestNotFoundError from './ManifestNotFoundError.js';
import NoMatchingRecipientError from './NoMatchingRecipientError.js';
import PersistenceCapabilityRequiredError from './PersistenceCapabilityRequiredError.js';
import PortNotImplementedError from './PortNotImplementedError.js';
import RecipientAlreadyExistsError from './RecipientAlreadyExistsError.js';
import RecipientNotFoundError from './RecipientNotFoundError.js';
import RestoreTooLargeError from './RestoreTooLargeError.js';
import RotationNotSupportedError from './RotationNotSupportedError.js';
import GitPlumbingInitializationError from './GitPlumbingInitializationError.js';

const ERROR_BY_CODE = Object.freeze({
  [CannotRemoveLastRecipientError.code]: CannotRemoveLastRecipientError,
  [DekUnwrapFailedError.code]: DekUnwrapFailedError,
  [GitError.code]: GitError,
  [GitPlumbingInitializationError.code]: GitPlumbingInitializationError,
  [IntegrityError.code]: IntegrityError,
  [InvalidChunkingStrategyError.code]: InvalidChunkingStrategyError,
  [InvalidOidError.code]: InvalidOidError,
  [InvalidOptionsError.code]: InvalidOptionsError,
  [ManifestIntegrityError.code]: ManifestIntegrityError,
  [ManifestNotFoundError.code]: ManifestNotFoundError,
  [NoMatchingRecipientError.code]: NoMatchingRecipientError,
  [PersistenceCapabilityRequiredError.code]: PersistenceCapabilityRequiredError,
  [PortNotImplementedError.code]: PortNotImplementedError,
  [RecipientAlreadyExistsError.code]: RecipientAlreadyExistsError,
  [RecipientNotFoundError.code]: RecipientNotFoundError,
  [RestoreTooLargeError.code]: RestoreTooLargeError,
  [RotationNotSupportedError.code]: RotationNotSupportedError,
});

export default function createCasError(message, code, meta = {}) {
  const ErrorClass = ERROR_BY_CODE[code];
  return ErrorClass ? new ErrorClass(message, meta) : new CasError(message, code, meta);
}
