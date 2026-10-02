import type { Place } from './models.ts';
import { stem } from './text.ts';
import {
  CATEGORY_SYNONYMS,
  CHEAP_BUDGET_RUB,
  CHEAP_WORDS,
  COMPANY_SYNONYMS,
  CUISINE_SYNONYMS,
  DISTRICT_MARKERS,
  FEATURE_SYNONYMS,
  METRO_MARKERS,
  MOOD_SYNONYMS,
  NEARBY_WORDS,
  PLACE_CUES,
  STOP_WORDS,
  STRONG_CUES,
  type Category,
  type Company,
  type Cuisine,
  type Feature,
  type Mood,
  type Synonyms,
} from './vocabulary.ts';

export interface Token {
  word: string;
  stem: string;
  original: string;
}

export interface PlaceMatch {
  place: Place;
  start: number;
  end: number;
}

export interface ParsedQuery {
  category: Category | null;
  cuisines: Cuisine[];
  mood: Mood | null;
  company: Company | null;
  features: Feature[];
  budgetMax: number | null;
  place: Place | null;
  placeText: string | null;
  nearMe: boolean;
}

const MIN_BUDGET_RUB = 100;
const MAX_BUDGET_RUB = 100_000;
const PLACE_TEXT_WORDS = 3;
const GENERIC_PLACE_WORDS = new Set(
  ['район', 'поселение', 'муниципальный', 'округ', 'городской', 'поселок', 'внутригородская'].map(stem),
);

export function tokenize(text: string): Token[] {
  return text
    .replaceAll('ё', 'е')
    .replaceAll('Ё', 'Е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((original) => original.length > 0)
    .map((original) => {
      const word = original.toLowerCase();
      return { word, stem: stem(word), original };
    });
}

function matches(token: Token | undefined, pattern: string): boolean {
  if (!token) return false;
  if (pattern.endsWith('*')) return token.word.startsWith(pattern.slice(0, -1));
  return token.stem === stem(pattern);
}

function matchesAny(token: Token | undefined, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matches(token, pattern));
}

interface Hit<Value> {
  value: Value;
  start: number;
}

function findHits<Value extends string>(
  tokens: readonly Token[],
  synonyms: Synonyms<Value>,
  used: Set<number>,
): Hit<Value>[] {
  const phrases = (Object.entries(synonyms) as [Value, readonly string[]][])
    .flatMap(([value, list]) => list.map((phrase) => ({ value, parts: phrase.split(' ') })))
    .sort((left, right) => right.parts.length - left.parts.length);
  const hits: Hit<Value>[] = [];
  for (const { value, parts } of phrases) {
    for (let start = 0; start + parts.length <= tokens.length; start += 1) {
      const span = parts.map((_, offset) => start + offset);
      if (span.some((index) => used.has(index))) continue;
      if (!parts.every((part, offset) => matches(tokens[start + offset], part))) continue;
      span.forEach((index) => used.add(index));
      hits.push({ value, start });
    }
  }
  return hits.sort((left, right) => left.start - right.start);
}

function first<Value>(hits: Hit<Value>[]): Value | null {
  return hits[0]?.value ?? null;
}

function unique<Value>(hits: Hit<Value>[]): Value[] {
  return [...new Set(hits.map((hit) => hit.value))];
}

function parseAmount(digits: string, suffix: string | undefined): number | null {
  const value = Number(digits.replace(/\s+/g, '')) * (suffix ? 1000 : 1);
  return value >= MIN_BUDGET_RUB && value <= MAX_BUDGET_RUB ? value : null;
}

const NUMBER = String.raw`(\d[\d ]{0,6}\d|\d)\s*(к|k|тыс\.?|тысяч[аи]?)?`;
const BUDGET_BEFORE = new RegExp(
  String.raw`(?:до|не дороже|не больше|максимум|бюджет(?:ом)?|за|около|в пределах|примерно)\s*${NUMBER}`,
  'iu',
);
const BUDGET_CURRENCY = new RegExp(String.raw`${NUMBER}\s*(?:₽|руб|р(?![а-я])|рублей)`, 'iu');

export function parseBudget(text: string, tokens: readonly Token[]): number | null {
  const normalized = text.toLowerCase();
  for (const pattern of [BUDGET_BEFORE, BUDGET_CURRENCY]) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      const amount = parseAmount(match[1], match[2]);
      if (amount !== null) return amount;
    }
  }
  return tokens.some((token) => matchesAny(token, CHEAP_WORDS)) ? CHEAP_BUDGET_RUB : null;
}

export interface Gazetteer {
  find(tokens: readonly Token[], used: ReadonlySet<number>): PlaceMatch | null;
  lookup(phrase: string): Place | null;
}

interface IndexedPlace {
  place: Place;
  stems: string[];
}

function placeStems(place: Place): string[] {
  const all = tokenize(place.name).map((token) => token.stem);
  return place.kind === 'district' ? all.filter((part) => !GENERIC_PLACE_WORDS.has(part)) : all;
}

export function createGazetteer(places: readonly Place[]): Gazetteer {
  const indexed: IndexedPlace[] = places
    .map((place) => ({ place, stems: placeStems(place) }))
    .filter((entry) => entry.stems.length > 0);

  function candidates(tokens: readonly Token[], used: ReadonlySet<number>) {
    const found: { entry: IndexedPlace; start: number; end: number }[] = [];
    for (const entry of indexed) {
      for (let start = 0; start + entry.stems.length <= tokens.length; start += 1) {
        const end = start + entry.stems.length;
        const covers = entry.stems.every((part, offset) => tokens[start + offset]?.stem === part);
        let free = true;
        for (let index = start; index < end; index += 1) if (used.has(index)) free = false;
        if (covers && free) found.push({ entry, start, end });
      }
    }
    return found;
  }

  return {
    find(tokens, used) {
      let best: { match: PlaceMatch; score: number } | null = null;
      for (const { entry, start, end } of candidates(tokens, used)) {
        const before = [tokens[start - 1], tokens[start - 2]];
        const metroMarked = before.some((token) => matchesAny(token, METRO_MARKERS));
        const districtMarked =
          before.some((token) => matchesAny(token, DISTRICT_MARKERS)) ||
          matchesAny(tokens[end], DISTRICT_MARKERS);
        const linked =
          ['с', 'со'].includes(tokens[start - 1]?.word ?? '') && matchesAny(tokens[start - 2], PLACE_CUES);
        const cued = matchesAny(tokens[start - 1], PLACE_CUES) || linked || metroMarked || districtMarked;
        const wholeText = start === 0 && end === tokens.length;
        if (!cued && entry.stems.length < 2 && !wholeText) continue;
        if (metroMarked && entry.place.kind !== 'metro') continue;
        const score =
          entry.stems.length * 10 +
          (districtMarked && entry.place.kind === 'district' ? 5 : 0) +
          (entry.place.kind === 'metro' ? 1 : 0);
        if (!best || score > best.score) best = { match: { place: entry.place, start, end }, score };
      }
      return best?.match ?? null;
    },

    lookup(phrase) {
      const tokens = tokenize(phrase).filter(
        (token) => !matchesAny(token, METRO_MARKERS) && !matchesAny(token, DISTRICT_MARKERS),
      );
      const exact = candidates(tokens, new Set()).filter(({ entry }) => entry.stems.length === tokens.length);
      const metro = exact.find(({ entry }) => entry.place.kind === 'metro');
      return (metro ?? exact[0])?.entry.place ?? null;
    },
  };
}

function unresolvedPlace(tokens: readonly Token[], used: ReadonlySet<number>): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (!token || !next) continue;
    const strong =
      matchesAny(token, STRONG_CUES) ||
      matchesAny(token, METRO_MARKERS) ||
      matchesAny(token, DISTRICT_MARKERS);
    const weak = ['на', 'в'].includes(token.word) && /^\p{Lu}/u.test(next.original);
    if (!strong && !weak) continue;
    const collected: string[] = [];
    for (let cursor = index + 1; cursor < tokens.length && collected.length < PLACE_TEXT_WORDS; cursor += 1) {
      const candidate = tokens[cursor];
      if (!candidate || used.has(cursor) || /^\d+$/.test(candidate.word)) break;
      if (STOP_WORDS.includes(candidate.word)) break;
      if (matchesAny(candidate, PLACE_CUES) && collected.length === 0) continue;
      if (matchesAny(candidate, PLACE_CUES)) break;
      collected.push(candidate.original);
    }
    if (collected.length > 0) return collected.join(' ');
  }
  return null;
}

export function parseQuery(text: string, gazetteer: Gazetteer): ParsedQuery {
  const tokens = tokenize(text);
  const used = new Set<number>();
  const match = gazetteer.find(tokens, used);
  if (match) for (let index = match.start; index < match.end; index += 1) used.add(index);

  const category = first(findHits(tokens, CATEGORY_SYNONYMS, used));
  const cuisines = unique(findHits(tokens, CUISINE_SYNONYMS, used));
  const company = first(findHits(tokens, COMPANY_SYNONYMS, new Set(used)));
  const mood = first(findHits(tokens, MOOD_SYNONYMS, used));
  const features = unique(findHits(tokens, FEATURE_SYNONYMS, used));
  const placeText = match ? null : unresolvedPlace(tokens, used);
  const nearMe = !match && !placeText && tokens.some((token) => matchesAny(token, NEARBY_WORDS));

  return {
    category,
    cuisines,
    mood,
    company,
    features,
    budgetMax: parseBudget(text, tokens),
    place: match?.place ?? null,
    placeText,
    nearMe,
  };
}

export function recognized(query: ParsedQuery): boolean {
  return (
    query.category !== null ||
    query.cuisines.length > 0 ||
    query.mood !== null ||
    query.company !== null ||
    query.features.length > 0 ||
    query.budgetMax !== null ||
    query.place !== null ||
    query.nearMe
  );
}
