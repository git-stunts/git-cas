import { describe, expect, it } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import Slug from '../../../../src/domain/value-objects/Slug.js';
import VaultTreeCodec, {
  VAULT_METADATA_ENTRY,
  VAULT_PRIVACY_INDEX_ENTRY,
} from '../../../../src/domain/services/VaultTreeCodec.js';

describe('VaultTreeCodec encoding', () => {
  it('encodes plain slug entries with the Slug tree-path contract', () => {
    const codec = new VaultTreeCodec();
    const records = codec.assetRecordsFromPlainEntries(new Map([
      ['demo/%/hello', 'tree-a'],
    ]));

    expect(records).toEqual([
      {
        mode: '040000',
        type: 'tree',
        oid: 'tree-a',
        name: Slug.from('demo/%/hello').toTreePath(),
      },
    ]);
  });

  it('emits bit-for-bit mktree lines for plain vault entries', () => {
    const codec = new VaultTreeCodec();
    const records = [
      ...codec.assetRecordsFromPlainEntries(new Map([['demo/hello', 'tree-a']])),
      codec.metadataRecord('meta-oid'),
    ];

    expect(codec.toTreeLines(records)).toEqual([
      '040000 tree tree-a\tdemo%2Fhello',
      `100644 blob meta-oid\t${VAULT_METADATA_ENTRY}`,
    ]);
  });
});

describe('VaultTreeCodec parsing', () => {
  it('separates metadata, privacy index, and plain asset entries', () => {
    const codec = new VaultTreeCodec();

    expect(codec.parseTreeEntries([
      { mode: '100644', type: 'blob', oid: 'meta-oid', name: VAULT_METADATA_ENTRY },
      { mode: '100644', type: 'blob', oid: 'privacy-oid', name: VAULT_PRIVACY_INDEX_ENTRY },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo%2Fhello' },
    ])).toEqual({
      entries: new Map([['demo/hello', 'tree-a']]),
      metadataBlobOid: 'meta-oid',
      privacyIndexBlobOid: 'privacy-oid',
    });
  });

  it('preserves privacy HMAC names instead of slug-decoding them', () => {
    const codec = new VaultTreeCodec();
    const hmacName = 'a'.repeat(64);

    const parsed = codec.parseTreeEntries([
      { mode: '040000', type: 'tree', oid: 'tree-a', name: hmacName },
    ], { privacyEnabled: true });

    expect(parsed.entries).toEqual(new Map([[hmacName, 'tree-a']]));
  });

  it('rejects malformed plain persisted names with CasError', () => {
    const codec = new VaultTreeCodec();

    expect(() => codec.parseTreeEntries([
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'bad\nname' },
    ])).toThrow(CasError);
  });
});
