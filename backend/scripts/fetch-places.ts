import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { areaCenter, districtArea, mergeNamed, type OsmElement, type OsmRelation } from './osm.ts';

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

const INSIDE_MKAD = '(55.57,37.37,55.91,37.85)';
const LANDMARKS = `[out:json][timeout:180];
(
  nwr["wikidata"]["name"]["tourism"~"^(attraction|museum|gallery|zoo|theme_park)$"]${INSIDE_MKAD};
  nwr["wikidata"]["name"]["amenity"~"^(theatre|concert_hall|arts_centre)$"]${INSIDE_MKAD};
  nwr["wikidata"]["name"]["leisure"~"^(park|garden|stadium)$"]${INSIDE_MKAD};
  nwr["wikidata"]["name"]["place"="square"]${INSIDE_MKAD};
);
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
  const stations = mergeNamed(await overpass<OsmElement>(STATIONS), 'metro');
  console.log(`metro stations: ${stations.length}`);
  const stationNames = new Set(stations.map((station) => station.name));
  const landmarks = mergeNamed(await overpass<OsmElement>(LANDMARKS), 'landmark').filter(
    (landmark) => !stationNames.has(landmark.name),
  );
  console.log(`landmarks: ${landmarks.length}`);
  const districts = (await overpass<OsmRelation>(DISTRICTS))
    .map((relation) => ({ name: relation.tags?.name?.trim() ?? '', area: districtArea(relation) }))
    .filter(({ name, area }) => name.length > 0 && area.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    .map(({ name, area }) => ({ kind: 'district' as const, name, ...areaCenter(area), area }));
  console.log(`districts: ${districts.length}`);
  const places = [...stations, ...landmarks, ...districts].map((place, index) => ({
    id: index + 1,
    ...place,
  }));
  await writeFile(OUTPUT, `${JSON.stringify(places)}\n`);
  console.log(`saved ${places.length} places to data/places.json`);
}

await main();
