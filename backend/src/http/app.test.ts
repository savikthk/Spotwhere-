import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SearchService } from '../services/search.ts';
import type { TasteService } from '../services/taste.ts';
import { buildApp } from './app.ts';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

const recommendation: Awaited<ReturnType<SearchService['recommend']>> = {
  query: {
    category: 'бар',
    cuisines: [],
    mood: 'тихо',
    company: null,
    features: [],
    budgetMax: 1500,
    place: { id: 1, kind: 'metro', name: 'Тверская', location: { lat: 55.7649, lon: 37.6063 } },
    placeText: null,
    nearMe: false,
  },
  interpretedBy: 'rules',
  area: {
    kind: 'metro',
    name: 'Тверская',
    center: { lat: 55.7649, lon: 37.6063 },
    districtId: null,
    radiusM: 800,
  },
  notes: [{ code: 'radius_expanded', radiusM: 1500 }],
  rankedBy: 'algorithm',
  results: [
    {
      venue: {
        id: 3,
        name: 'Тихий двор',
        description: 'Бар',
        address: 'Тверская, 12',
        tags: ['бар', 'тихо'],
        avgBill: 1500,
        mapsUrl: 'https://yandex.ru/maps/?text=x',
        location: { lat: 55.768, lon: 37.604 },
      },
      distanceM: 381.6,
      score: 2.3,
      matched: ['тихо'],
    },
  ],
};

async function start(
  overrides: { search?: Partial<SearchService>; taste?: Partial<TasteService>; frontendDir?: string } = {},
) {
  const search: SearchService = { recommend: vi.fn().mockResolvedValue(recommendation), ...overrides.search };
  const taste: TasteService = {
    like: vi.fn().mockResolvedValue(true),
    dislike: vi.fn().mockResolvedValue(true),
    ...overrides.taste,
  };
  app = await buildApp({ search, taste, frontendDir: overrides.frontendDir ?? null });
  return { app, search, taste };
}

describe('POST /recommend', () => {
  it('passes the text, user and location and answers with places, notes and distances', async () => {
    const { app, search } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/recommend',
      payload: { text: ' тихий бар у Тверской ', user_id: 42, lat: 55.76, lon: 37.6 },
    });
    expect(response.statusCode).toBe(200);
    expect(search.recommend).toHaveBeenCalledWith({
      text: 'тихий бар у Тверской',
      userId: 42,
      point: { lat: 55.76, lon: 37.6 },
    });
    expect(response.json()).toEqual({
      query: {
        category: 'бар',
        cuisines: [],
        mood: 'тихо',
        company: null,
        features: [],
        budget_max: 1500,
        location: 'Тверская',
      },
      interpreted_by: 'rules',
      ranked_by: 'algorithm',
      place: { kind: 'metro', name: 'Тверская', lat: 55.7649, lon: 37.6063, radius_m: 800 },
      notes: [{ code: 'radius_expanded', radius_m: 1500 }],
      results: [
        {
          id: 3,
          name: 'Тихий двор',
          description: 'Бар',
          address: 'Тверская, 12',
          tags: ['бар', 'тихо'],
          avg_bill: 1500,
          lat: 55.768,
          lon: 37.604,
          maps_url: 'https://yandex.ru/maps/?text=x',
          distance_m: 382,
          matched: ['тихо'],
        },
      ],
    });
  });

  it('works without a user and a location', async () => {
    const { app, search } = await start();
    await app.inject({ method: 'POST', url: '/recommend', payload: { text: 'бар' } });
    expect(search.recommend).toHaveBeenCalledWith({ text: 'бар', userId: null, point: null });
  });

  it.each([
    [{ text: '' }],
    [{ text: 'бар', lat: 55.7 }],
    [{ text: 'бар', lat: 120, lon: 37 }],
    [{ text: 'x'.repeat(501) }],
    [{}],
  ])('rejects %j', async (payload) => {
    const { app } = await start();
    const response = await app.inject({ method: 'POST', url: '/recommend', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_failed' });
  });

  it('hides internal errors', async () => {
    const { app } = await start({
      search: { recommend: vi.fn().mockRejectedValue(new Error('db is down')) },
    });
    const response = await app.inject({ method: 'POST', url: '/recommend', payload: { text: 'бар' } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });
});

describe('likes and dislikes', () => {
  it('records a reaction and reports an unknown venue', async () => {
    const { app, taste } = await start({ taste: { dislike: vi.fn().mockResolvedValue(false) } });
    const liked = await app.inject({ method: 'POST', url: '/like', payload: { user_id: 7, venue_id: 3 } });
    expect(liked.json()).toEqual({ status: 'ok' });
    expect(taste.like).toHaveBeenCalledWith(7, 3);
    const unknown = await app.inject({
      method: 'POST',
      url: '/dislike',
      payload: { user_id: 7, venue_id: 99 },
    });
    expect(unknown.statusCode).toBe(404);
    const invalid = await app.inject({ method: 'POST', url: '/like', payload: { user_id: 7 } });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('the Mini App', () => {
  it('serves the frontend and the health check', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spotwhere-frontend-'));
    await writeFile(join(dir, 'index.html'), '<h1>SPOTWHERE</h1>');
    const { app } = await start({ frontendDir: dir });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('SPOTWHERE');
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      service: 'spotwhere',
    });
  });
});
