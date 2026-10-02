import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import type { Place, Venue } from '../domain/models.ts';
import { createGazetteer } from '../domain/query.ts';
import type { CandidatePicker, Geocoder, LlmQuery, QueryInterpreter } from '../ports.ts';
import * as places from '../repositories/places.ts';
import * as venues from '../repositories/venues.ts';
import { createCachedGeocoder } from './geocoding.ts';
import { createSearchService, type Recommendation } from './search.ts';
import { createTasteService } from './taste.ts';

const pool = testPool();

const TVERSKAYA = { lat: 55.764895, lon: 37.606313 };
const BOLSHOI = { lat: 55.7603, lon: 37.6186 };

const venue = (id: number, name: string, tags: string[], lat: number, lon: number): Venue => ({
  id,
  name,
  description: name,
  address: '',
  tags,
  avgBill: 1500,
  mapsUrl: `https://yandex.ru/maps/?text=${id}`,
  location: { lat, lon },
});

const VENUES = [
  venue(1, 'Hidden', ['бар', 'шумно', 'компания'], 55.7655, 37.6065),
  venue(2, 'Beermarket', ['паб', 'пиво', 'шумно', 'друзья'], 55.766, 37.608),
  venue(3, 'Тихий двор', ['бар', 'тихо', 'вдвоём', 'веранда'], 55.768, 37.604),
  venue(4, 'Cofix', ['кафе', 'кофе', 'тихо', 'вдвоём'], 55.7652, 37.607),
  venue(5, 'Cofix', ['кафе', 'кофе', 'тихо', 'вдвоём'], 55.77, 37.62),
  venue(6, 'Космик', ['боулинг', 'компания'], 55.78, 37.63),
  venue(7, 'Арбатское кафе', ['кафе', 'тихо', 'вдвоём'], 55.7505, 37.5905),
  venue(8, 'Далёкий бар', ['бар', 'шумно', 'друзья'], 55.7, 37.5),
  venue(9, 'Ресторан у театра', ['ресторан', 'романтика', 'вдвоём'], 55.7603, 37.6185),
];

const ARBAT = [
  [
    [
      [37.58, 55.745],
      [37.6, 55.745],
      [37.6, 55.756],
      [37.58, 55.756],
      [37.58, 55.745],
    ],
  ],
];

const PLACES: Place[] = [
  { id: 1, kind: 'metro', name: 'Тверская', location: TVERSKAYA },
  { id: 2, kind: 'district', name: 'район Арбат', location: { lat: 55.7505, lon: 37.59 } },
];

const NOTHING: LlmQuery = {
  category: null,
  cuisines: [],
  mood: null,
  company: null,
  features: [],
  budgetMax: null,
  location: null,
};

let geocoder: { geocode: ReturnType<typeof vi.fn<Geocoder['geocode']>> };
let interpreter: { interpret: ReturnType<typeof vi.fn<QueryInterpreter['interpret']>> };
let picker: { pick: ReturnType<typeof vi.fn<CandidatePicker['pick']>> };

function service(options: { withModel?: boolean } = {}) {
  const withModel = options.withModel ?? true;
  return createSearchService({
    pool,
    gazetteer: createGazetteer(PLACES),
    geocoder: createCachedGeocoder({ pool, geocoder, logger: { warn: vi.fn() } }),
    interpreter: withModel ? interpreter : null,
    picker: withModel ? picker : null,
  });
}

const ids = (recommendation: Recommendation) => recommendation.results.map((entry) => entry.venue.id);

beforeEach(async () => {
  await resetDatabase(pool);
  await venues.replaceAll(pool, VENUES);
  await places.replaceAll(pool, [
    { ...PLACES[0]!, area: null },
    { ...PLACES[1]!, area: ARBAT },
  ]);
  geocoder = { geocode: vi.fn<Geocoder['geocode']>().mockResolvedValue(null) };
  interpreter = { interpret: vi.fn<QueryInterpreter['interpret']>().mockResolvedValue(null) };
  picker = { pick: vi.fn<CandidatePicker['pick']>().mockResolvedValue(null) };
});

afterAll(async () => {
  await closeTestPool();
});

describe('searching near a place named in the query', () => {
  it('finds bars at the metro station, nearest first, without the language model', async () => {
    const found = await service().recommend({ text: 'бар у метро Тверская', userId: null, point: null });
    expect(found).toMatchObject({
      interpretedBy: 'rules',
      area: { kind: 'metro', name: 'Тверская', radiusM: 800 },
      notes: [],
      rankedBy: 'algorithm',
    });
    expect(ids(found)).toEqual([1, 3]);
    expect(found.results[0]?.distanceM).toBeLessThan(100);
    expect(interpreter.interpret).not.toHaveBeenCalled();
  });

  it('prefers what the guest asked for over a few hundred metres', async () => {
    const found = await service().recommend({
      text: 'тихий бар на двоих у Тверской',
      userId: null,
      point: null,
    });
    expect(ids(found)).toEqual([3, 1]);
    expect(found.results[0]?.matched).toEqual(['тихо', 'вдвоём']);
  });

  it('widens the radius before it gives up on the category', async () => {
    const bowling = await service().recommend({ text: 'боулинг у Тверской', userId: null, point: null });
    expect(ids(bowling)).toEqual([6]);
    expect(bowling.notes).toEqual([{ code: 'radius_expanded', radiusM: 2500 }]);

    const quest = await service().recommend({ text: 'квест у Тверской', userId: null, point: null });
    expect(quest.notes).toEqual([{ code: 'filters_relaxed' }]);
    expect(ids(quest)).toEqual([4, 1, 2, 3]);
  });

  it('searches inside a district', async () => {
    const found = await service().recommend({ text: 'кафе на Арбате', userId: null, point: null });
    expect(found.area).toMatchObject({ kind: 'district', name: 'район Арбат' });
    expect(ids(found)).toEqual([7]);
  });

  it('geocodes an unknown landmark once and remembers it', async () => {
    geocoder.geocode.mockResolvedValue({ label: 'Большой театр', location: BOLSHOI });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const found = await service().recommend({
        text: 'ресторан у Большого театра',
        userId: null,
        point: null,
      });
      expect(found.area).toMatchObject({ kind: 'geocoded', name: 'Большой театр', radiusM: 800 });
      expect(ids(found)).toEqual([9]);
    }
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
  });

  it('says when a place is not found instead of silently searching the whole city', async () => {
    const found = await service({ withModel: false }).recommend({
      text: 'бар у Несуществующего моста',
      userId: null,
      point: null,
    });
    expect(found.area).toBeNull();
    expect(found.notes).toEqual([{ code: 'place_not_found', text: 'Несуществующего моста' }]);
    expect(ids(found).sort()).toEqual([1, 3, 8]);
  });
});

describe('searching near the guest', () => {
  it('uses the guest location when the query names no place', async () => {
    const found = await service().recommend({ text: 'кофейня рядом', userId: null, point: TVERSKAYA });
    expect(found.area).toMatchObject({ kind: 'user', radiusM: 1000 });
    expect(ids(found)).toEqual([4]);
  });

  it('prefers the place in the query over the guest location', async () => {
    const found = await service().recommend({ text: 'кафе на Арбате', userId: null, point: TVERSKAYA });
    expect(found.area).toMatchObject({ kind: 'district' });
  });

  it('explains a location outside Moscow and asks for one when needed', async () => {
    const far = await service().recommend({
      text: 'кофейня рядом',
      userId: null,
      point: { lat: 59.93, lon: 30.31 },
    });
    expect(far.area).toBeNull();
    expect(far.notes).toEqual([{ code: 'outside_city' }]);

    const unknown = await service().recommend({ text: 'кофейня рядом', userId: null, point: null });
    expect(unknown.notes).toEqual([{ code: 'location_needed' }]);
  });
});

describe('the language model', () => {
  it('interprets only what the rules did not understand', async () => {
    interpreter.interpret.mockResolvedValue({ ...NOTHING, category: 'бар', location: 'Тверская' });
    const found = await service().recommend({ text: 'куда бы сходить', userId: null, point: null });
    expect(interpreter.interpret).toHaveBeenCalledWith('куда бы сходить');
    expect(found).toMatchObject({ interpretedBy: 'rules+llm', area: { kind: 'metro', name: 'Тверская' } });
    expect(ids(found)).toEqual([1, 3]);
  });

  it('picks only among the candidates the algorithm found', async () => {
    picker.pick.mockResolvedValue([9, 7]);
    const found = await service().recommend({ text: 'куда бы сходить', userId: null, point: null });
    const offered = (picker.pick.mock.calls[0]?.[1] ?? []).map((candidate) => candidate.id);
    expect(new Set(offered).size).toBe(offered.length);
    expect(offered.filter((id) => id === 4 || id === 5)).toHaveLength(1);
    expect(offered).toHaveLength(8);
    expect(found.rankedBy).toBe('llm');
    expect(ids(found).slice(0, 2)).toEqual([9, 7]);
    expect(ids(found)).toHaveLength(offered.length);
  });

  it('keeps the algorithm order when the model has no answer', async () => {
    const found = await service().recommend({ text: 'куда бы сходить', userId: null, point: null });
    expect(found.rankedBy).toBe('algorithm');
    expect(found.interpretedBy).toBe('rules');
  });
});

describe('taste', () => {
  it('moves liked kinds of places up', async () => {
    const taste = createTasteService(pool);
    expect(await taste.like(5, 3)).toBe(true);
    expect(await taste.like(5, 99)).toBe(false);
    const found = await service().recommend({ text: 'бар у Тверской', userId: 5, point: null });
    expect(ids(found)).toEqual([3, 1]);
    const stranger = await service().recommend({ text: 'бар у Тверской', userId: 6, point: null });
    expect(ids(stranger)).toEqual([1, 3]);
  });
});
