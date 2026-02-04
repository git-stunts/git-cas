import { bench, describe } from 'vitest';
import CasService from '../../src/domain/services/CasService.js';

describe('CasService Benchmarks', () => {
  const service = new CasService();
  
  bench('service initialization', () => {
    new CasService();
  });
});
