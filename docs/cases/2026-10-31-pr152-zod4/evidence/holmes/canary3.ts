import type { KdfSchema, ManifestSchema } from '../../src/domain/schemas/ManifestSchema.d.ts';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Out<S> = S extends { parse: (x: unknown) => infer R } ? R : 'NOPARSE';
// negative control: must error if types are real
const neg: Equal<Out<typeof KdfSchema>['algorithm'], 'nope'> = true;
// zod-4-only internals present?
const isZod4: Equal<'_zod' extends keyof typeof ManifestSchema ? 1 : 0, 1> = true;
void neg; void isZod4;
