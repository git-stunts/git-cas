import { bench, describe } from 'vitest';
import CasService from '../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../src/infrastructure/codecs/JsonCodec.js';

const mockPersistence = {
  writeBlob: async () => 'oid',
  writeTree: async () => 'oid',
  readBlob: async () => Buffer.alloc(0),
};

describe('CasService Benchmarks', () => {
  const service = new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new JsonCodec() });

  bench('service initialization', () => {
    new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new JsonCodec() });
  });
});
