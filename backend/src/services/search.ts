import type { Pool } from '../db/pool.ts';
import { insideMoscow } from '../domain/geo.ts';
import type { GeoPoint, Place } from '../domain/models.ts';
import { parseQuery, recognized, type Gazetteer, type ParsedQuery } from '../domain/query.ts';
import { rankCandidates, type Candidate, type Ranked } from '../domain/rank.ts';
import type { CandidatePicker, Geocoder, LlmQuery, QueryInterpreter } from '../ports.ts';
import * as venues from '../repositories/venues.ts';
import * as weights from '../repositories/weights.ts';

export type AreaKind = 'user' | 'metro' | 'district' | 'geocoded';

export interface SearchArea {
  kind: AreaKind;
  name: string | null;
  center: GeoPoint;
  districtId: number | null;
  radiusM: number;
}

export type Note =
  | { code: 'place_not_found'; text: string }
  | { code: 'outside_city' }
  | { code: 'location_needed' }
  | { code: 'radius_expanded'; radiusM: number }
  | { code: 'area_expanded'; bufferM: number }
  | { code: 'filters_relaxed' };

export interface RecommendInput {
  text: string;
  userId: number | null;
  point: GeoPoint | null;
}

export interface Recommendation {
  query: ParsedQuery;
  interpretedBy: 'rules' | 'rules+llm';
  area: SearchArea | null;
  notes: Note[];
  rankedBy: 'algorithm' | 'llm';
  results: Ranked[];
}

export interface SearchService {
  recommend(input: RecommendInput): Promise<Recommendation>;
}

export interface SearchDependencies {
  pool: Pool;
  gazetteer: Gazetteer;
  geocoder: Geocoder;
  interpreter: QueryInterpreter | null;
  picker: CandidatePicker | null;
}

const RADIUS_M: Record<Exclude<AreaKind, 'district'>, number> = { user: 1000, metro: 800, geocoded: 800 };
const RADIUS_STEPS_M = [1500, 2500, 4000];
const DISTRICT_BUFFERS_M = [0, 1000, 2000];
const DISTRICT_PROXIMITY_M = 2000;
const CANDIDATE_LIMIT = 300;
const RESULT_LIMIT = 10;
const PICK_FROM = 10;
const PICK_WHEN_MORE_THAN = 5;

function needsLanguageModel(query: ParsedQuery): boolean {
  return !recognized(query) || (query.place === null && query.placeText !== null);
}

function merge(rules: ParsedQuery, model: LlmQuery, gazetteer: Gazetteer): ParsedQuery {
  const place = rules.place ?? (model.location ? gazetteer.lookup(model.location) : null);
  return {
    category: rules.category ?? model.category,
    cuisines: rules.cuisines.length > 0 ? rules.cuisines : model.cuisines,
    mood: rules.mood ?? model.mood,
    company: rules.company ?? model.company,
    features: rules.features.length > 0 ? rules.features : model.features,
    budgetMax: rules.budgetMax ?? model.budgetMax,
    place,
    placeText: place ? null : (model.location ?? rules.placeText),
    nearMe: rules.nearMe,
  };
}

function placeArea(place: Place): SearchArea {
  return place.kind === 'district'
    ? { kind: 'district', name: place.name, center: place.location, districtId: place.id, radiusM: 0 }
    : { kind: 'metro', name: place.name, center: place.location, districtId: null, radiusM: RADIUS_M.metro };
}

interface Found {
  candidates: Candidate[];
  step: number | null;
  relaxed: boolean;
}

export function createSearchService({
  pool,
  gazetteer,
  geocoder,
  interpreter,
  picker,
}: SearchDependencies): SearchService {
  async function understand(
    text: string,
  ): Promise<{ query: ParsedQuery; interpretedBy: Recommendation['interpretedBy'] }> {
    const rules = parseQuery(text, gazetteer);
    if (!interpreter || !needsLanguageModel(rules)) return { query: rules, interpretedBy: 'rules' };
    const model = await interpreter.interpret(text);
    return model
      ? { query: merge(rules, model, gazetteer), interpretedBy: 'rules+llm' }
      : { query: rules, interpretedBy: 'rules' };
  }

  async function locate(
    query: ParsedQuery,
    point: GeoPoint | null,
  ): Promise<{ area: SearchArea | null; notes: Note[] }> {
    const notes: Note[] = [];
    if (query.place) return { area: placeArea(query.place), notes };
    if (query.placeText) {
      const found = await geocoder.geocode(query.placeText);
      if (found) {
        return {
          area: {
            kind: 'geocoded',
            name: found.label,
            center: found.location,
            districtId: null,
            radiusM: RADIUS_M.geocoded,
          },
          notes,
        };
      }
      notes.push({ code: 'place_not_found', text: query.placeText });
    }
    if (point && insideMoscow(point)) {
      return {
        area: { kind: 'user', name: null, center: point, districtId: null, radiusM: RADIUS_M.user },
        notes,
      };
    }
    if (point) notes.push({ code: 'outside_city' });
    else if (query.nearMe) notes.push({ code: 'location_needed' });
    return { area: null, notes };
  }

  async function find(query: ParsedQuery, area: SearchArea | null): Promise<Found> {
    const steps: (number | null)[] =
      area === null
        ? [null]
        : area.districtId !== null
          ? DISTRICT_BUFFERS_M
          : [area.radiusM, ...RADIUS_STEPS_M.filter((step) => step > area.radiusM)];
    const strict = { category: query.category, cuisines: query.cuisines, budgetMax: query.budgetMax };
    const loose = { category: null, cuisines: [], budgetMax: query.budgetMax };
    const filterSets = query.category !== null || query.cuisines.length > 0 ? [strict, loose] : [strict];
    for (const [index, filters] of filterSets.entries()) {
      for (const step of steps) {
        const candidates = await venues.search(pool, {
          center: area?.center ?? null,
          radiusM: area && area.districtId === null ? step : null,
          districtId: area?.districtId ?? null,
          bufferM: area?.districtId !== null ? (step ?? 0) : 0,
          ...filters,
          limit: CANDIDATE_LIMIT,
        });
        if (candidates.length > 0) return { candidates, step, relaxed: index > 0 };
      }
    }
    return { candidates: [], step: steps[0] ?? null, relaxed: false };
  }

  function expansionNotes(area: SearchArea | null, found: Found): Note[] {
    const notes: Note[] = [];
    if (area && found.step !== null && found.candidates.length > 0) {
      if (area.districtId !== null && found.step > 0)
        notes.push({ code: 'area_expanded', bufferM: found.step });
      if (area.districtId === null && found.step > area.radiusM)
        notes.push({ code: 'radius_expanded', radiusM: found.step });
    }
    if (found.relaxed) notes.push({ code: 'filters_relaxed' });
    return notes;
  }

  async function choose(
    text: string,
    ranked: Ranked[],
  ): Promise<{ results: Ranked[]; rankedBy: Recommendation['rankedBy'] }> {
    if (!picker || ranked.length <= PICK_WHEN_MORE_THAN)
      return { results: ranked.slice(0, RESULT_LIMIT), rankedBy: 'algorithm' };
    const offered = ranked.slice(0, PICK_FROM);
    const ids = await picker.pick(
      text,
      offered.map(({ venue, distanceM }) => ({
        id: venue.id,
        name: venue.name,
        description: venue.description,
        tags: venue.tags,
        distanceM,
      })),
    );
    if (!ids) return { results: ranked.slice(0, RESULT_LIMIT), rankedBy: 'algorithm' };
    const picked = ids.flatMap((id) => offered.filter((entry) => entry.venue.id === id));
    const rest = ranked.filter((entry) => !ids.includes(entry.venue.id));
    return { results: [...picked, ...rest].slice(0, RESULT_LIMIT), rankedBy: 'llm' };
  }

  return {
    async recommend({ text, userId, point }) {
      const { query, interpretedBy } = await understand(text);
      const { area, notes } = await locate(query, point);
      const found = await find(query, area);
      const tastes = userId === null ? new Map<string, number>() : await weights.forUser(pool, userId);
      const proximity =
        area === null
          ? null
          : area.districtId !== null
            ? DISTRICT_PROXIMITY_M + (found.step ?? 0)
            : (found.step ?? area.radiusM);
      const ranked = rankCandidates(found.candidates, query, tastes, proximity);
      const { results, rankedBy } = await choose(text, ranked);
      return {
        query,
        interpretedBy,
        area,
        notes: [...notes, ...expansionNotes(area, found)],
        rankedBy,
        results,
      };
    },
  };
}
