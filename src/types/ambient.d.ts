/**
 * Ambient module declarations for dependencies that lack type definitions.
 */

declare module '@git-stunts/plumbing' {
  interface ExecuteOptions {
    args: string[];
    input?: string | Uint8Array;
    env?: Record<string, string | undefined>;
  }

  interface StreamResult {
    collect(options?: { asString?: boolean; maxBytes?: number }): Promise<string | Uint8Array>;
  }

  type ShellRunner = (options: Record<string, unknown>) => Promise<unknown>;

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
