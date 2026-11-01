import type { z } from 'zod';
import type {
  ChunkSchema,
  ChunkingSchema,
  CompressionSchema,
  EncryptionSchema,
  KdfSchema,
  ManifestSchema,
  RecipientSchema,
  SubManifestRefSchema,
} from '../../src/domain/schemas/ManifestSchema.d.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

const kdfAlgorithmsInfer: Equal<
  z.infer<typeof KdfSchema>['algorithm'],
  'pbkdf2' | 'scrypt'
> = true;
const kdfKeyLengthInputIsOptional: Equal<
  z.input<typeof KdfSchema>['keyLength'],
  number | undefined
> = true;
const compressionAlgorithmsInfer: Equal<
  z.infer<typeof CompressionSchema>['algorithm'],
  'gzip'
> = true;
const chunkingStrategiesInfer: Equal<
  z.infer<typeof ChunkingSchema>['strategy'],
  'fixed' | 'cdc'
> = true;
const encryptionSchemesInfer: Equal<
  z.infer<typeof EncryptionSchema>['scheme'],
  'whole' | 'framed' | 'convergent'
> = true;
const manifestVersionIsNumber: Equal<
  z.infer<typeof ManifestSchema>['version'],
  number
> = true;
void kdfAlgorithmsInfer;
void kdfKeyLengthInputIsOptional;
void compressionAlgorithmsInfer;
void chunkingStrategiesInfer;
void encryptionSchemesInfer;
void manifestVersionIsNumber;

// Defaults accept omission but must be present in parsed output.
const kdfKeyLengthOutputIsNumber: Equal<
  z.output<typeof KdfSchema>['keyLength'],
  number
> = true;
const encryptionFlagInputIsOptional: Equal<
  z.input<typeof EncryptionSchema>['encrypted'],
  true | undefined
> = true;
const encryptionFlagOutputIsTrue: Equal<
  z.output<typeof EncryptionSchema>['encrypted'],
  true
> = true;
const manifestVersionInputIsOptional: Equal<
  z.input<typeof ManifestSchema>['version'],
  number | undefined
> = true;

const chunkShape: Equal<
  z.output<typeof ChunkSchema>,
  { index: number; size: number; digest: string; blob: string }
> = true;
const subManifestRefShape: Equal<
  z.output<typeof SubManifestRefSchema>,
  { oid: string; chunkCount: number; startIndex: number }
> = true;
const recipientShape: Equal<
  z.output<typeof RecipientSchema>,
  {
    label: string;
    wrappedDek: string;
    nonce: string;
    tag: string;
    kekType?: string | undefined;
    keyVersion?: number | undefined;
  }
> = true;

void kdfKeyLengthOutputIsNumber;
void encryptionFlagInputIsOptional;
void encryptionFlagOutputIsTrue;
void manifestVersionInputIsOptional;
void chunkShape;
void subManifestRefShape;
void recipientShape;
