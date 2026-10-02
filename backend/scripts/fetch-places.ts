import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { areaCenter, districtArea, mergeStations, type OsmNode, type OsmRelation } from './osm.ts';

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ATTEMPTS = 3;
const MOSCOW = 'area["name"="Москва"]["admin_level"="4"]->.msk;';
const OUTPUT = new URL('../data/places.json', import.meta.url);

const STATIONS = `[out:json][timeout:120];${MOSCOW}
node(area.msk)["railway"="station"]["station"~"^(subway|light_rail|monorail)$"];
out tags center;`;

const DISTRICTS = `[out:json][timeout:300];${MOSCOW}
relation(area.msk)["boundary"="administrative"]["admin_level"="8"];
out geom;`;

async function overpass<Element>(query: string): Promise<Element[]> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    for (const mirror of MIRRORS) {
      try {
        const response = await fetch(mirror, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'spotwhere-places/0.2 (+https://github.com/savikthk/Spotwhere-)',
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(330_000),
        });
        const body = await response.text();
        if (response.ok && body.startsWith('{')) {
          return (JSON.parse(body) as { elements: Element[] }).elements;
        }
        console.warn(`${mirror}: ${response.status}, retrying`);
      } catch (error) {
        console.warn(`${mirror}: ${(error as Error).message}, retrying`);
      }
    }
    await sleep(5_000 * attempt);
  }
  throw new Error('Overpass did not answer, try again later');
}

async function main() {
  const stations = mergeStations(await overpass<OsmNode>(STATIONS));
  console.log(`metro stations: ${stations.length}`);
  const districts = (await overpass<OsmRelation>(DISTRICTS))
    .map((relation) => ({ name: relation.tags?.name?.trim() ?? '', area: districtArea(relation) }))
    .filter(({ name, area }) => name.length > 0 && area.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    .map(({ name, area }) => ({ kind: 'district' as const, name, ...areaCenter(area), area }));
  console.log(`districts: ${districts.length}`);
  const places = [...stations, ...districts].map((place, index) => ({ id: index + 1, ...place }));
  await writeFile(OUTPUT, `${JSON.stringify(places)}\n`);
  console.log(`saved ${places.length} places to data/places.json`);
}

await main();
