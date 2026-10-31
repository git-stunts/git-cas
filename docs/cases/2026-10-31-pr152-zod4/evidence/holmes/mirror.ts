import { z } from 'zod';
import * as D from '../../src/domain/schemas/ManifestSchema.d.ts';
const isCanonicalBase64 = (_v: string) => true;
const base64DecodedLength = (_v: string) => 0;
function base64BytesSchema(field: string, byteLength: number) {
  return z.string()
    .min(1)
    .refine((value) => isCanonicalBase64(value), {
      message: `${field} must be canonical base64`,
    })
    .refine((value) => isCanonicalBase64(value) && base64DecodedLength(value) === byteLength, {
      message: `${field} must decode to ${byteLength} bytes`,
    });
}

/** Matches a lowercase hex Git OID — SHA-1 (40 chars) or SHA-256 (64 chars). */
const gitOidSchema = z.string().regex(
  /^[0-9a-f]{40}([0-9a-f]{24})?$/,
  'must be a 40- or 64-character lowercase hex Git OID',
);

/** Validates a single chunk entry within a manifest. */
const ChunkSchema = z.object({
  index: z.number().int().min(0),
  size: z.number().int().positive(),
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'digest must be a 64-character lowercase hex string'),
  blob: gitOidSchema,
});

/** Validates KDF parameters stored alongside encryption metadata. */
const KdfSchema = z.object({
  algorithm: z.enum(['pbkdf2', 'scrypt']),
  salt: z.string()
    .min(1)
    .refine((value) => isCanonicalBase64(value), {
      message: 'salt must be canonical base64',
    }),
  iterations: z.number().int().positive().optional(),
  cost: z.number().int().positive().optional(),
  blockSize: z.number().int().positive().optional(),
  parallelization: z.number().int().positive().optional(),
  keyLength: z.number().int().positive().default(32),
});

/** Validates a single recipient entry in an envelope-encrypted manifest. */
const RecipientSchema = z.object({
  label: z.string().min(1),
  wrappedDek: base64BytesSchema('wrappedDek', 32),
  nonce: base64BytesSchema('nonce', 12),
  tag: base64BytesSchema('tag', 16),
  kekType: z.string().optional(),
  keyVersion: z.number().int().min(0).optional(),
});

/** Validates the encryption metadata attached to an encrypted manifest. */
const EncryptionBaseSchema = {
  algorithm: z.literal('aes-256-gcm'),
  encrypted: z.literal(true).default(true),
  kdf: KdfSchema.optional(),
  recipients: z.array(RecipientSchema).min(1).optional(),
  keyVersion: z.number().int().min(0).optional(),
};

const WholeEncryptionSchema = z.object({
  scheme: z.literal('whole'),
  ...EncryptionBaseSchema,
  nonce: base64BytesSchema('nonce', 12),
  tag: base64BytesSchema('tag', 16),
  frameBytes: z.undefined().optional(),
});

const FramedEncryptionSchema = z.object({
  scheme: z.literal('framed'),
  ...EncryptionBaseSchema,
  frameBytes: z.number().int().positive(),
  nonce: z.undefined().optional(),
  tag: z.undefined().optional(),
});

const ConvergentEncryptionSchema = z.object({
  scheme: z.literal('convergent'),
  ...EncryptionBaseSchema,
  nonce: z.undefined().optional(),
  tag: z.undefined().optional(),
  frameBytes: z.undefined().optional(),
});

const EncryptionSchema = z.union([
  WholeEncryptionSchema,
  FramedEncryptionSchema,
  ConvergentEncryptionSchema,
]);

/** Validates compression metadata. */
const CompressionSchema = z.object({
  algorithm: z.enum(['gzip']),
});

/** Validates fixed-size chunking parameters. */
const FixedChunkingSchema = z.object({
  strategy: z.literal('fixed'),
  params: z.object({
    chunkSize: z.number().int().positive(),
  }),
});

/** Validates content-defined chunking (CDC) parameters. */
const CdcChunkingSchema = z.object({
  strategy: z.literal('cdc'),
  params: z.object({
    target: z.number().int().positive(),
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    normalized: z.boolean().optional(),
  }),
});

/** Validates chunking metadata (fixed or CDC). */
const ChunkingSchema = z.discriminatedUnion('strategy', [
  FixedChunkingSchema,
  CdcChunkingSchema,
]);

/** Validates a sub-manifest reference in a v2 Merkle manifest. */
const SubManifestRefSchema = z.object({
  oid: gitOidSchema,
  chunkCount: z.number().int().positive(),
  startIndex: z.number().int().min(0),
});

/** Validates a complete file manifest. */
const ManifestSchema = z.object({
  version: z.number().int().min(1).max(2).default(1),
  formatVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/, 'manifestHash must be a 64-char hex string').optional(),
  slug: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().int().min(0),
  chunks: z.array(ChunkSchema),
  encryption: EncryptionSchema.optional(),
  compression: CompressionSchema.optional(),
  chunking: ChunkingSchema.optional(),
  subManifests: z.array(SubManifestRefSchema).max(10_000).optional(),
});
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Both<R, Dd> = [Equal<z.input<R>, z.input<Dd>>, Equal<z.output<R>, z.output<Dd>>];
const c1: Both<typeof ChunkSchema, typeof D.ChunkSchema> = [true, true];
const c2: Both<typeof KdfSchema, typeof D.KdfSchema> = [true, true];
const c3: Both<typeof RecipientSchema, typeof D.RecipientSchema> = [true, true];
const c4: Both<typeof EncryptionSchema, typeof D.EncryptionSchema> = [true, true];
const c5: Both<typeof CompressionSchema, typeof D.CompressionSchema> = [true, true];
const c6: Both<typeof FixedChunkingSchema, typeof D.FixedChunkingSchema> = [true, true];
const c7: Both<typeof CdcChunkingSchema, typeof D.CdcChunkingSchema> = [true, true];
const c8: Both<typeof ChunkingSchema, typeof D.ChunkingSchema> = [true, true];
const c9: Both<typeof SubManifestRefSchema, typeof D.SubManifestRefSchema> = [true, true];
const c10: Both<typeof ManifestSchema, typeof D.ManifestSchema> = [true, true];
// exact declared-type identity (generic structure, not just inferred shape)
const s1: Equal<typeof ChunkingSchema, typeof D.ChunkingSchema> = true;
const s2: Equal<typeof KdfSchema, typeof D.KdfSchema> = true;
const s3: Equal<typeof EncryptionSchema, typeof D.EncryptionSchema> = true;
const s4: Equal<typeof ManifestSchema, typeof D.ManifestSchema> = true;
const s5: Equal<typeof CompressionSchema, typeof D.CompressionSchema> = true;
const s6: Equal<typeof RecipientSchema, typeof D.RecipientSchema> = true;
// D exports nothing extra / missing
type Keys = Exclude<keyof typeof D, 'ChunkSchema'|'KdfSchema'|'RecipientSchema'|'EncryptionSchema'|'CompressionSchema'|'FixedChunkingSchema'|'CdcChunkingSchema'|'ChunkingSchema'|'SubManifestRefSchema'|'ManifestSchema'>;
const k: Equal<Keys, never> = true;
void [c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,s1,s2,s3,s4,s5,s6,k, gitOidSchema];
type DO = typeof D.EncryptionSchema extends z.ZodUnion<infer O> ? O : never;
type RO = typeof EncryptionSchema extends z.ZodUnion<infer O> ? O : never;
const u1: Equal<RO, Readonly<DO>> = true;
const u2: Equal<RO[0], DO[0]> = true;
const u3: Equal<RO[1], DO[1]> = true;
const u4: Equal<RO[2], DO[2]> = true;
void [u1,u2,u3,u4];
