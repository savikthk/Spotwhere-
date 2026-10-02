import { loadConfig } from './config.ts';
import { loadMigrations, migrate } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { createGazetteer } from './domain/query.ts';
import { createNominatim } from './geocoding/nominatim.ts';
import { buildApp } from './http/app.ts';
import { createGigaChat } from './llm/gigachat.ts';
import type { Logger } from './ports.ts';
import * as places from './repositories/places.ts';
import { createCachedGeocoder } from './services/geocoding.ts';
import { createSearchService } from './services/search.ts';
import { createTasteService } from './services/taste.ts';

const USER_AGENT = 'spotwhere/0.2 (+https://github.com/savikthk/Spotwhere-)';

const config = loadConfig();
let sink: Logger = { warn: (details, message) => console.warn(message, details) };
const logger: Logger = { warn: (details, message) => sink.warn(details, message) };

const pool = createPool(config.databaseUrl, {
  onError: (error) => logger.warn({ err: error }, 'idle database client failed'),
});
await migrate(pool, await loadMigrations());

const known = await places.listAll(pool);
const gigachat = config.gigachat ? createGigaChat({ ...config.gigachat, logger }) : null;
const search = createSearchService({
  pool,
  gazetteer: createGazetteer(known),
  geocoder: createCachedGeocoder({ pool, geocoder: createNominatim({ userAgent: USER_AGENT }), logger }),
  interpreter: gigachat?.interpreter ?? null,
  picker: gigachat?.picker ?? null,
});

const app = await buildApp({
  search,
  taste: createTasteService(pool),
  frontendDir: config.frontendDir,
  logger: { level: 'info' },
});
sink = app.log;

if (known.length === 0) app.log.warn('no metro stations or districts loaded, run npm run db:load');
if (!gigachat) app.log.warn('GIGACHAT_KEY is not set, queries are understood by the rules only');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}

await app.listen({ host: config.host, port: config.port });
