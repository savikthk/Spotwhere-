import { describe, expect, it } from 'vitest';
import {
  assembleRings,
  containsPoint,
  districtArea,
  mergeNamed,
  simplifyRing,
  type Position,
} from './osm.ts';

describe('mergeNamed', () => {
  it('joins platforms of one station and keeps distant namesakes apart', () => {
    const merged = mergeNamed(
      [
        { type: 'node', lat: 55.752, lon: 37.601, tags: { name: 'Арбатская' } },
        { type: 'node', lat: 55.754, lon: 37.603, tags: { name: 'Арбатская' } },
        { type: 'node', lat: 55.9, lon: 37.5, tags: { name: 'Арбатская' } },
        { type: 'node', lat: 55.765, lon: 37.604, tags: { name: 'Тверская' } },
        { type: 'node', lat: 55.7, lon: 37.6 },
      ],
      'metro',
    );
    expect(merged).toEqual([
      { kind: 'metro', name: 'Арбатская', aliases: [], lat: 55.753, lon: 37.602 },
      { kind: 'metro', name: 'Арбатская', aliases: [], lat: 55.9, lon: 37.5 },
      { kind: 'metro', name: 'Тверская', aliases: [], lat: 55.765, lon: 37.604 },
    ]);
  });

  it('takes the centre of areas and collects alternative names', () => {
    const merged = mergeNamed(
      [
        {
          type: 'relation',
          center: { lat: 55.7298, lon: 37.6031 },
          tags: {
            name: 'Центральный парк культуры и отдыха имени Горького',
            alt_name: 'Парк Горького;ЦПКиО',
            short_name: 'Парк Горького',
          },
        },
        {
          type: 'way',
          center: { lat: 55.7603, lon: 37.6186 },
          tags: { name: 'Большой театр', alt_name: 'большой театр' },
        },
      ],
      'landmark',
    );
    expect(merged).toEqual([
      { kind: 'landmark', name: 'Большой театр', aliases: [], lat: 55.7603, lon: 37.6186 },
      {
        kind: 'landmark',
        name: 'Центральный парк культуры и отдыха имени Горького',
        aliases: ['Парк Горького', 'ЦПКиО'],
        lat: 55.7298,
        lon: 37.6031,
      },
    ]);
  });
});

describe('district polygons', () => {
  const square: Position[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
    [0, 0],
  ];

  it('joins boundary pieces in any direction into closed rings', () => {
    const rings = assembleRings([
      [
        [0, 0],
        [4, 0],
      ],
      [
        [0, 4],
        [4, 4],
        [4, 0],
      ],
      [
        [0, 4],
        [0, 0],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.[0]).toEqual(rings[0]?.at(-1));
    expect(rings[0]).toHaveLength(5);
  });

  it('drops pieces that never close', () => {
    expect(
      assembleRings([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toEqual([]);
  });

  it('tells whether a point is inside a ring', () => {
    expect(containsPoint(square, [2, 2])).toBe(true);
    expect(containsPoint(square, [5, 2])).toBe(false);
  });

  it('removes points that do not change the shape and keeps the ring closed', () => {
    const dense: Position[] = [
      [0, 0],
      [1, 0.00001],
      [2, 0],
      [4, 0],
      [4, 2],
      [4, 4],
      [2, 4],
      [0, 4],
      [0, 2],
      [0, 0],
    ];
    const simplified = simplifyRing(dense, 0.001);
    expect(simplified[0]).toEqual(simplified.at(-1));
    expect(simplified.length).toBeLessThan(dense.length);
    expect(simplified.length).toBeGreaterThanOrEqual(4);
  });

  it('puts inner rings into the outer ring that holds them', () => {
    const geometry = (points: Position[]) => points.map(([lon, lat]) => ({ lat, lon }));
    const area = districtArea({
      type: 'relation',
      members: [
        { type: 'way', role: 'outer', geometry: geometry(square) },
        {
          type: 'way',
          role: 'inner',
          geometry: geometry([
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
            [1, 1],
          ]),
        },
      ],
    });
    expect(area).toHaveLength(1);
    expect(area[0]).toHaveLength(2);
  });
});
