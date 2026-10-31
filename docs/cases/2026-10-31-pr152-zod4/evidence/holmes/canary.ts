import type { z } from 'zod';
import type { KdfSchema, ManifestSchema } from '../../src/domain/schemas/ManifestSchema.d.ts';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const wrong1: Equal<z.infer<typeof KdfSchema>['algorithm'], 'nope'> = true;
type IsAny<T> = 0 extends 1 & T ? true : false;
const notAny: IsAny<typeof ManifestSchema> = false;
const zIsAny: IsAny<z.ZodString> = false;
void wrong1; void notAny; void zIsAny;
