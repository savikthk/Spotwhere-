import { describe, expect, it } from 'vitest';
import { withBaseline } from './baseline.ts';

describe('withBaseline', () => {
  it('adds the usual mood and company of the category only when missing', () => {
    expect(withBaseline(['бар', 'коктейли'])).toEqual(['бар', 'коктейли', 'шумно', 'компания']);
    expect(withBaseline(['бар', 'тихо'])).toEqual(['бар', 'тихо', 'компания']);
    expect(withBaseline(['кафе', 'кафе', 'один'])).toEqual(['кафе', 'один', 'тихо']);
    expect(withBaseline([])).toEqual(['тихо', 'вдвоём']);
  });
});
