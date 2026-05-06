import { describe, expect, it } from 'vitest';
import PortNotImplementedError from '../../../src/domain/errors/PortNotImplementedError.js';
import GitPlumbingFactoryPort from '../../../src/ports/GitPlumbingFactoryPort.js';

describe('GitPlumbingFactoryPort', () => {
  it('throws a domain-specific error when not implemented', async () => {
    const port = new GitPlumbingFactoryPort();

    await expect(port.create()).rejects.toBeInstanceOf(PortNotImplementedError);
  });
});
