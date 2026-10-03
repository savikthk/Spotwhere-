import type { GeoPoint } from './domain/models.ts';
import type { Category, Company, Cuisine, Feature, Mood } from './domain/vocabulary.ts';

export interface LlmQuery {
  category: Category | null;
  cuisines: Cuisine[];
  mood: Mood | null;
  company: Company | null;
  features: Feature[];
  budgetMax: number | null;
  location: string | null;
}

export interface QueryInterpreter {
  interpret(text: string): Promise<LlmQuery | null>;
}

export interface PickCandidate {
  id: number;
  name: string;
  description: string;
  tags: readonly string[];
  distanceM: number | null;
}

export interface CandidatePicker {
  pick(text: string, candidates: readonly PickCandidate[]): Promise<number[] | null>;
}

export interface GeocodeResult {
  label: string;
  location: GeoPoint;
}

export interface Geocoder {
  geocode(phrase: string): Promise<GeocodeResult | null>;
}

export interface Logger {
  warn(details: object, message: string): void;
}
