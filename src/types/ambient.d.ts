/**
 * Ambient module declarations for dependencies that lack type definitions.
 */

declare module '@git-stunts/plumbing' {
  interface ExecuteOptions {
    args: string[];
    input?: string | Uint8Array;
    env?: Record<string, string | undefined>;
  }

  interface StreamResult extends AsyncIterable<Uint8Array | string> {
    collect(options?: { asString?: boolean; maxBytes?: number }): Promise<string | Uint8Array>;
    destroy(): Promise<void>;
    finished: Promise<{ code: number; stderr: string }>;
  }

  type ShellRunner = (options: Record<string, unknown>) => Promise<unknown>;

  interface GitObjectInfo {
    oid: string;
    type: string;
    size: number;
  }

  interface GitObject extends GitObjectInfo {
    content: Uint8Array;
  }

  interface GitCatFileSession {
    info(objectName: string): Promise<GitObjectInfo>;
    read(objectName: string, options?: { maxBytes?: number }): Promise<GitObject>;
    close(): Promise<void>;
    terminate(): Promise<void>;
  }

  interface GitMktreeSession {
    write(
      entries: Array<{ mode: string; type: string; oid: string; name: string }>
    ): Promise<string>;
    close(): Promise<void>;
    terminate(): Promise<void>;
  }

  interface GitFastImportSession {
    writeBlob(content: string | Uint8Array): Promise<string>;
    checkpoint(): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }

  export class GitObjectMissingError extends Error {
    details?: Record<string, unknown>;
  }

  export class GitProtocolError extends Error {}

  export class InvalidArgumentError extends Error {}

  export class ShellRunnerFactory {
    static ENV_BUN: 'bun';
    static ENV_DENO: 'deno';
    static ENV_NODE: 'node';
    static create(options?: Record<string, unknown>): ShellRunner;
    static validateCwd(cwd: string): Promise<string>;
  }

  export default class GitPlumbing {
    constructor(options: { runner: ShellRunner; cwd?: string });
    static createDefault(options?: { cwd?: string; env?: string }): Promise<GitPlumbing>;
    static createRepository(options?: { cwd?: string; env?: string }): Promise<unknown>;
    execute(options: ExecuteOptions): Promise<string>;
    executeStream(options: ExecuteOptions): Promise<StreamResult>;
    openCatFileSession(): Promise<GitCatFileSession>;
    openMktreeSession(): Promise<GitMktreeSession>;
    openFastImportSession(): Promise<GitFastImportSession>;
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
