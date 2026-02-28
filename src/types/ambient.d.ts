/**
 * Ambient module declarations for dependencies that lack type definitions.
 */

declare module '@git-stunts/plumbing' {
  interface ExecuteOptions {
    args: string[];
    input?: string | Buffer;
  }

  interface StreamResult {
    collect(options?: { asString?: boolean }): Promise<Uint8Array>;
  }

  export default class GitPlumbing {
    execute(options: ExecuteOptions): Promise<string>;
    executeStream(options: ExecuteOptions): Promise<StreamResult>;
  }
}

declare module 'bun' {
  export class CryptoHasher {
    constructor(algorithm: string);
    update(data: Buffer | Uint8Array | string): this;
    digest(encoding: 'hex'): string;
    digest(): Uint8Array;
  }
}
