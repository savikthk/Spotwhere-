import type { Venue } from './models.ts';
import { nameKey } from './text.ts';

export interface Candidate {
  venue: Venue;
  distanceM: number | null;
}

export interface Wishes {
  mood: string | null;
  company: string | null;
  features: readonly string[];
  cuisines: readonly string[];
}

export interface Ranked extends Candidate {
  score: number;
  matched: string[];
}

const CUISINE_WEIGHT = 1.5;
const PROXIMITY_WEIGHT = 1.5;
const TASTE_LIMIT = 2;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function score(
  candidate: Candidate,
  wishes: Wishes,
  weights: ReadonlyMap<string, number>,
  radiusM: number | null,
) {
  const tags = new Set(candidate.venue.tags);
  const soft = [wishes.mood, wishes.company, ...wishes.features].filter(
    (wish): wish is string => wish !== null && tags.has(wish),
  );
  const cuisines = wishes.cuisines.filter((cuisine) => tags.has(cuisine));
  const taste = clamp(
    candidate.venue.tags.reduce((sum, tag) => sum + (weights.get(tag) ?? 0), 0),
    TASTE_LIMIT,
  );
  const proximity =
    radiusM !== null && radiusM > 0 && candidate.distanceM !== null
      ? PROXIMITY_WEIGHT * Math.max(0, 1 - candidate.distanceM / radiusM)
      : 0;
  return {
    score: soft.length + cuisines.length * CUISINE_WEIGHT + taste + proximity,
    matched: [...cuisines, ...soft],
  };
}

function byScore(left: Ranked, right: Ranked): number {
  return (
    right.score - left.score ||
    (left.distanceM ?? Infinity) - (right.distanceM ?? Infinity) ||
    left.venue.id - right.venue.id
  );
}

export function rankCandidates(
  candidates: readonly Candidate[],
  wishes: Wishes,
  weights: ReadonlyMap<string, number>,
  radiusM: number | null,
): Ranked[] {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, ...score(candidate, wishes, weights, radiusM) }))
    .sort(byScore);
  const seen = new Set<string>();
  return ranked.filter((entry) => {
    const key = nameKey(entry.venue.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
