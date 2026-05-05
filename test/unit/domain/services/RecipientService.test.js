import { describe, it, expect } from 'vitest';
import RecipientService from '../../../../src/domain/services/RecipientService.js';

describe('RecipientService', () => {
  it('lists recipient labels from envelope metadata', () => {
    const service = new RecipientService({ crypto: {}, keyResolver: {} });
    const manifest = {
      encryption: {
        recipients: [
          { label: 'alice' },
        ],
      },
    };

    expect(service.listRecipients(manifest)).toEqual(['alice']);
  });
});
