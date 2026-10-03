import { describe, expect, it, vi } from 'vitest';
import { createGigaChat } from './gigachat.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function answer(content: string): Response {
  return json({ choices: [{ message: { content } }] });
}

function setup(...replies: Response[]) {
  let clock = 1_000;
  const fetch = vi.fn<typeof globalThis.fetch>();
  fetch.mockResolvedValueOnce(json({ access_token: 'token-1', expires_at: 10_000_000 }));
  for (const reply of replies) fetch.mockResolvedValueOnce(reply);
  const logger = { warn: vi.fn() };
  const gigachat = createGigaChat({
    key: 'auth-key',
    scope: 'GIGACHAT_API_PERS',
    model: 'GigaChat',
    logger,
    fetch,
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { ...gigachat, fetch, logger, advance };
}

const CANDIDATES = [
  { id: 11, name: 'Hidden', description: 'Бар', tags: ['бар'], distanceM: 120 },
  { id: 12, name: 'Beermarket', description: 'Паб', tags: ['паб'], distanceM: 400 },
  { id: 13, name: 'Let’s Rock', description: 'Бар', tags: ['бар'], distanceM: null },
];

describe('GigaChat interpreter', () => {
  it('keeps only known values from the answer', async () => {
    const { interpreter, fetch } = setup(
      answer(
        'Вот: {"category": "бар", "cuisines": ["суши", "марсианская"], "mood": "грустно", "company": "друзья", ' +
          '"features": ["веранда", "бассейн"], "budget_max": 2000, "location": "  Патриаршие пруды "}',
      ),
    );

    expect(await interpreter.interpret('бар с друзьями у патриков до 2000')).toEqual({
      category: 'бар',
      cuisines: ['суши'],
      mood: null,
      company: 'друзья',
      features: ['веранда'],
      budgetMax: 2000,
      location: 'Патриаршие пруды',
    });
    const [authUrl, auth] = fetch.mock.calls[0] ?? [];
    expect(authUrl).toBe('https://ngw.devices.sberbank.ru:9443/api/v2/oauth');
    expect(new Headers(auth?.headers).get('Authorization')).toBe('Basic auth-key');
    const [chatUrl, chat] = fetch.mock.calls[1] ?? [];
    expect(chatUrl).toBe('https://gigachat.devices.sberbank.ru/api/v1/chat/completions');
    expect(new Headers(chat?.headers).get('Authorization')).toBe('Bearer token-1');
    expect(JSON.parse(String(chat?.body))).toMatchObject({ model: 'GigaChat', temperature: 0.1 });
  });

  it('reuses the token until it is about to expire', async () => {
    const { interpreter, fetch } = setup(answer('{"category": "кафе"}'), answer('{"category": "бар"}'));
    await interpreter.interpret('кафе');
    expect(await interpreter.interpret('бар')).toMatchObject({ category: 'бар', location: null });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an answer without JSON', answer('Не знаю')],
    ['a failed request', json({ message: 'busy' }, 503)],
  ])('returns nothing and logs on %s', async (_case, reply) => {
    const { interpreter, logger } = setup(reply);
    expect(await interpreter.interpret('куда сходить')).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('GigaChat outages', () => {
  it('stops calling an unreachable service for two minutes', async () => {
    const { interpreter, picker, fetch, advance } = setup();
    fetch.mockReset();
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await interpreter.interpret('бар')).toBeNull();
    expect(await picker.pick('бар', CANDIDATES)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(120_000);
    fetch.mockResolvedValueOnce(json({ access_token: 'token-2', expires_at: 10_000_000 }));
    fetch.mockResolvedValueOnce(answer('[12]'));
    expect(await picker.pick('бар', CANDIDATES)).toEqual([12]);
  });

  it('keeps calling after a bad answer of a working service', async () => {
    const { interpreter, fetch } = setup(answer('Не знаю'), answer('{"category": "кафе"}'));
    expect(await interpreter.interpret('куда')).toBeNull();
    expect(await interpreter.interpret('кафе')).toMatchObject({ category: 'кафе' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('pauses after a server error', async () => {
    const { interpreter, fetch } = setup(json({ message: 'down' }, 503));
    expect(await interpreter.interpret('бар')).toBeNull();
    expect(await interpreter.interpret('бар')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('GigaChat picker', () => {
  it('keeps only ids from the list, once each', async () => {
    const { picker, fetch } = setup(answer('[13, 99, 11, 13]'));
    expect(await picker.pick('бар у Тверской', CANDIDATES)).toEqual([13, 11]);
    const body = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as { messages: { content: string }[] };
    expect(body.messages[1]?.content).toContain('11. Hidden (Бар; бар, 120 м)');
  });

  it('returns nothing when the model picks none of the candidates', async () => {
    const { picker } = setup(answer('[1, 2]'));
    expect(await picker.pick('бар', CANDIDATES)).toBeNull();
  });
});
