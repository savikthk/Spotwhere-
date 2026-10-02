import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ranked } from '../domain/rank.ts';
import type { Note, Recommendation, SearchService } from '../services/search.ts';
import type { TasteService } from '../services/taste.ts';

export interface AppOptions {
  search: SearchService;
  taste: TasteService;
  frontendDir: string | null;
  logger?: FastifyServerOptions['logger'];
}

const RecommendBody = z
  .object({
    text: z.string().trim().min(1).max(500),
    user_id: z.number().int().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  })
  .refine((body) => (body.lat === undefined) === (body.lon === undefined), {
    message: 'Pass both lat and lon or neither',
    path: ['lat'],
  });

const ReactionBody = z.object({
  user_id: z.number().int(),
  venue_id: z.number().int().positive(),
});

function noteDto(note: Note) {
  switch (note.code) {
    case 'radius_expanded':
      return { code: note.code, radius_m: note.radiusM };
    case 'area_expanded':
      return { code: note.code, buffer_m: note.bufferM };
    case 'place_not_found':
      return { code: note.code, text: note.text };
    default:
      return { code: note.code };
  }
}

function resultDto({ venue, distanceM, matched }: Ranked) {
  return {
    id: venue.id,
    name: venue.name,
    description: venue.description,
    address: venue.address,
    tags: venue.tags,
    avg_bill: venue.avgBill,
    lat: venue.location.lat,
    lon: venue.location.lon,
    maps_url: venue.mapsUrl,
    distance_m: distanceM === null ? null : Math.round(distanceM),
    matched,
  };
}

export function recommendationDto({ query, interpretedBy, area, notes, rankedBy, results }: Recommendation) {
  return {
    query: {
      category: query.category,
      cuisines: query.cuisines,
      mood: query.mood,
      company: query.company,
      features: query.features,
      budget_max: query.budgetMax,
      location: query.place?.name ?? query.placeText,
    },
    interpreted_by: interpretedBy,
    ranked_by: rankedBy,
    place: area
      ? {
          kind: area.kind,
          name: area.name,
          lat: area.center.lat,
          lon: area.center.lon,
          radius_m: area.districtId === null ? area.radiusM : null,
        }
      : null,
    notes: notes.map(noteDto),
    results: results.map(resultDto),
  };
}

export async function buildApp({
  search,
  taste,
  frontendDir,
  logger = false,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 16 * 1024 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'validation_failed', message: error.message });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/health', () => ({ status: 'ok', service: 'spotwhere' }));

  app.post('/recommend', { schema: { body: RecommendBody } }, async (request) => {
    const { text, user_id: userId, lat, lon } = request.body;
    const point = lat !== undefined && lon !== undefined ? { lat, lon } : null;
    return recommendationDto(await search.recommend({ text, userId: userId ?? null, point }));
  });

  for (const action of ['like', 'dislike'] as const) {
    app.post(`/${action}`, { schema: { body: ReactionBody } }, async (request, reply) => {
      const { user_id: userId, venue_id: venueId } = request.body;
      const known = await taste[action](userId, venueId);
      if (!known) return reply.code(404).send({ error: 'venue_not_found' });
      return { status: 'ok' };
    });
  }

  if (frontendDir) {
    await app.register(fastifyStatic, { root: resolve(frontendDir), index: 'index.html' });
  }

  return app;
}
