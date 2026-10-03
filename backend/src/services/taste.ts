import type { Pool } from '../db/pool.ts';
import * as venues from '../repositories/venues.ts';
import * as weights from '../repositories/weights.ts';

const LIKE = 0.2;
const DISLIKE = -0.1;

export interface TasteService {
  like(userId: number, venueId: number): Promise<boolean>;
  dislike(userId: number, venueId: number): Promise<boolean>;
}

export function createTasteService(pool: Pool): TasteService {
  async function adjust(userId: number, venueId: number, delta: number): Promise<boolean> {
    const tags = await venues.findTags(pool, venueId);
    if (!tags) return false;
    await weights.add(pool, userId, tags, delta);
    return true;
  }
  return {
    like: (userId, venueId) => adjust(userId, venueId, LIKE),
    dislike: (userId, venueId) => adjust(userId, venueId, DISLIKE),
  };
}
