export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Venue {
  id: number;
  name: string;
  description: string;
  address: string;
  tags: string[];
  avgBill: number;
  mapsUrl: string;
  location: GeoPoint;
}

export const PLACE_KINDS = ['metro', 'district'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface Place {
  id: number;
  kind: PlaceKind;
  name: string;
  location: GeoPoint;
}
