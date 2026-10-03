import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIES, COMPANIES, CUISINES, FEATURES, MOODS } from '../domain/vocabulary.ts';
import type { CandidatePicker, LlmQuery, Logger, PickCandidate, QueryInterpreter } from '../ports.ts';

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const TOKEN_MARGIN_MS = 60_000;
const OUTAGE_PAUSE_MS = 120_000;
const PICK_LIMIT = 5;
const LOCATION_MAX_LENGTH = 80;

export interface GigaChatOptions {
  key: string;
  scope: string;
  model: string;
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const TokenResponse = z.object({ access_token: z.string().min(1), expires_at: z.number() });
const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const oneOf = <Values extends readonly [string, ...string[]]>(values: Values) =>
  z.enum(values).nullable().optional().catch(null);
const someOf = <Values extends readonly [string, ...string[]]>(values: Values) =>
  z
    .array(z.unknown())
    .optional()
    .catch([])
    .transform((items) => [
      ...new Set((items ?? []).filter((item): item is Values[number] => values.includes(item as string))),
    ]);

const InterpretedQuery = z.object({
  category: oneOf(CATEGORIES),
  cuisines: someOf(CUISINES),
  mood: oneOf(MOODS),
  company: oneOf(COMPANIES),
  features: someOf(FEATURES),
  budget_max: z.number().int().min(100).max(100_000).nullable().optional().catch(null),
  location: z
    .string()
    .trim()
    .max(LOCATION_MAX_LENGTH)
    .nullable()
    .optional()
    .catch(null)
    .transform((value) => (value ? value : null)),
});

const list = (values: readonly string[]) => values.map((value) => `"${value}"`).join(', ');

export const INTERPRET_PROMPT = [
  'Ты разбираешь запрос пользователя, который ищет, куда сходить в Москве.',
  'Верни СТРОГО один JSON-объект без пояснений:',
  `{"category": одно из [${list(CATEGORIES)}] или null,`,
  ` "cuisines": массив из [${list(CUISINES)}],`,
  ` "mood": одно из [${list(MOODS)}] или null,`,
  ` "company": одно из [${list(COMPANIES)}] или null,`,
  ` "features": массив из [${list(FEATURES)}],`,
  ' "budget_max": число рублей или null,',
  ' "location": станция метро, район, улица или ориентир в именительном падеже, иначе null}',
  'Не придумывай того, чего нет в запросе.',
].join('\n');

function jsonPart(content: string, open: '{' | '['): unknown {
  const close = open === '{' ? '}' : ']';
  const start = content.indexOf(open);
  const end = content.lastIndexOf(close);
  if (start < 0 || end <= start) throw new Error('The model answered without JSON');
  return JSON.parse(content.slice(start, end + 1));
}

class ServiceDown extends Error {}

function outage(error: unknown): boolean {
  return (
    error instanceof ServiceDown ||
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}

function describe(candidate: PickCandidate): string {
  const distance = candidate.distanceM === null ? '' : `, ${Math.round(candidate.distanceM)} м`;
  return `${candidate.id}. ${candidate.name} (${candidate.description}; ${candidate.tags.join(', ')}${distance})`;
}

export function createGigaChat(options: GigaChatOptions): {
  interpreter: QueryInterpreter;
  picker: CandidatePicker;
} {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 5_000;
  let token: { value: string; expiresAt: number } | null = null;
  let pausedUntil = 0;

  async function guarded<T>(work: () => Promise<T | null>, failure: string): Promise<T | null> {
    if (now() < pausedUntil) return null;
    try {
      return await work();
    } catch (error) {
      if (outage(error)) pausedUntil = now() + OUTAGE_PAUSE_MS;
      options.logger.warn({ err: error, paused: outage(error) }, failure);
      return null;
    }
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.expiresAt - TOKEN_MARGIN_MS) return token.value;
    const response = await request(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${options.key}`,
        RqUID: randomUUID(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ scope: options.scope }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500) throw new ServiceDown(`GigaChat auth answered ${response.status}`);
    if (!response.ok) throw new Error(`GigaChat auth answered ${response.status}`);
    const parsed = TokenResponse.parse(await response.json());
    token = { value: parsed.access_token, expiresAt: parsed.expires_at };
    return token.value;
  }

  async function complete(system: string, user: string): Promise<string> {
    const response = await request(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) token = null;
    if (response.status >= 500) throw new ServiceDown(`GigaChat answered ${response.status}`);
    if (!response.ok) throw new Error(`GigaChat answered ${response.status}`);
    const content = ChatResponse.parse(await response.json()).choices[0]?.message.content;
    if (content === undefined) throw new Error('GigaChat answered without a message');
    return content;
  }

  const interpreter: QueryInterpreter = {
    interpret: (text) =>
      guarded(async () => {
        const parsed = InterpretedQuery.parse(jsonPart(await complete(INTERPRET_PROMPT, text), '{'));
        const query: LlmQuery = {
          category: parsed.category ?? null,
          cuisines: parsed.cuisines,
          mood: parsed.mood ?? null,
          company: parsed.company ?? null,
          features: parsed.features,
          budgetMax: parsed.budget_max ?? null,
          location: parsed.location,
        };
        return query;
      }, 'GigaChat could not interpret the query'),
  };

  const picker: CandidatePicker = {
    pick: (text, candidates) =>
      guarded(async () => {
        if (candidates.length === 0) return null;
        const allowed = new Set(candidates.map((candidate) => candidate.id));
        const answer = jsonPart(
          await complete(
            [
              'Ты помогаешь выбрать заведение из готового списка.',
              `Выбери до ${PICK_LIMIT} мест, которые лучше всего подходят под запрос, лучшие первыми.`,
              'Выбирай ТОЛЬКО из списка. Верни СТРОГО JSON-массив id, например [12, 7, 3].',
            ].join('\n'),
            `Запрос: "${text}"\nСписок:\n${candidates.map(describe).join('\n')}`,
          ),
          '[',
        );
        if (!Array.isArray(answer)) return null;
        const ids = [
          ...new Set(
            answer
              .map((item: unknown) =>
                typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item,
              )
              .filter((id): id is number => typeof id === 'number' && allowed.has(id)),
          ),
        ].slice(0, PICK_LIMIT);
        return ids.length > 0 ? ids : null;
      }, 'GigaChat could not pick venues'),
  };

  return { interpreter, picker };
}
