import { describe, expect, it } from 'vitest';
import type { Venue } from './models.ts';
import { rankCandidates, type Wishes } from './rank.ts';

const venue = (id: number, name: string, tags: string[]): Venue => ({
  id,
  name,
  description: '',
  address: '',
  tags,
  avgBill: 1500,
  mapsUrl: '',
  location: { lat: 55.76, lon: 37.6 },
});

const NONE: Wishes = { mood: null, company: null, features: [], cuisines: [] };
const ids = (ranked: { venue: Venue }[]) => ranked.map((entry) => entry.venue.id);

describe('rankCandidates', () => {
  it('puts the nearest first when nothing else differs', () => {
    const ranked = rankCandidates(
      [
        { venue: venue(1, 'Hidden', ['бар']), distanceM: 700 },
        { venue: venue(2, 'Beermarket', ['бар']), distanceM: 120 },
        { venue: venue(3, 'Let’s Rock', ['бар']), distanceM: 400 },
      ],
      NONE,
      new Map(),
      800,
    );
    expect(ids(ranked)).toEqual([2, 3, 1]);
  });

  it('lets wishes and taste outweigh a few hundred metres', () => {
    const ranked = rankCandidates(
      [
        { venue: venue(1, 'Рядом', ['бар', 'шумно']), distanceM: 50 },
        { venue: venue(2, 'Тихий двор', ['бар', 'тихо', 'веранда']), distanceM: 600 },
      ],
      { ...NONE, mood: 'тихо', features: ['веранда'] },
      new Map(),
      800,
    );
    expect(ids(ranked)).toEqual([2, 1]);
    expect(ranked[0]?.matched).toEqual(['тихо', 'веранда']);

    const tasted = rankCandidates(
      [
        { venue: venue(1, 'Паб', ['паб']), distanceM: 100 },
        { venue: venue(2, 'Крафт', ['паб', 'крафт']), distanceM: 500 },
      ],
      NONE,
      new Map([['крафт', 5]]),
      800,
    );
    expect(ids(tasted)).toEqual([2, 1]);
    expect(tasted[0]?.score).toBeCloseTo(2 + 1.5 * (1 - 500 / 800));
  });

  it('keeps only the best branch of a chain', () => {
    const ranked = rankCandidates(
      [
        { venue: venue(1, 'Cofix', ['кафе']), distanceM: 900 },
        { venue: venue(2, 'COFIX', ['кафе']), distanceM: 150 },
        { venue: venue(3, 'Даблби', ['кафе']), distanceM: 300 },
      ],
      NONE,
      new Map(),
      1000,
    );
    expect(ids(ranked)).toEqual([2, 3]);
  });

  it('orders a city wide search by wishes and id', () => {
    const ranked = rankCandidates(
      [
        { venue: venue(5, 'Б', ['кафе']), distanceM: null },
        { venue: venue(4, 'А', ['кафе', 'суши']), distanceM: null },
        { venue: venue(3, 'В', ['кафе']), distanceM: null },
      ],
      { ...NONE, cuisines: ['суши'] },
      new Map(),
      null,
    );
    expect(ids(ranked)).toEqual([4, 3, 5]);
  });
});
