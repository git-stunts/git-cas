import { materializeFile, type MaterializeFileOptions } from '../../files.d.ts';

async function* source(): AsyncIterable<Uint8Array> { yield new Uint8Array(); }
const options: MaterializeFileOptions = {
  source: source(), baseDirectory: '/cache', outputPath: 'doc.md',
  expectedSha256: 'a'.repeat(64), signal: new AbortController().signal,
};
const published: Promise<{ bytesWritten: number }> = materializeFile(options);
void published;
// @ts-expect-error A filesystem boundary is mandatory.
materializeFile({ source: source(), outputPath: 'doc.md' });
// @ts-expect-error Strings are not byte chunks.
materializeFile({ source: (async function* invalid() { yield 'text'; })(), baseDirectory: '/cache', outputPath: 'doc.md' });
