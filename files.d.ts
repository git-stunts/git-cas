export interface MaterializeFileOptions {
  /** Stream completion must include any required source authentication. */
  source: AsyncIterable<Uint8Array>;
  /** Existing directory boundary for the caller-selected destination. */
  baseDirectory: string;
  /** Relative to baseDirectory, or an absolute path inside it. Parent must exist. */
  outputPath: string;
  /** Optional whole-plaintext SHA-256, checked before the rename. */
  expectedSha256?: string;
  signal?: AbortSignal;
}

/**
 * Stream to a private sibling temporary file, then atomically replace the destination.
 * Does not fsync, create parents, manage retention or make a directory transaction.
 */
export function materializeFile(options: MaterializeFileOptions): Promise<{ bytesWritten: number }>;
