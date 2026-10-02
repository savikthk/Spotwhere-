import { describe, expect, it } from 'vitest';
import type { Place, PlaceKind } from './models.ts';
import { createGazetteer, parseQuery, recognized } from './query.ts';

let nextId = 1;
const place = (kind: PlaceKind, name: string): Place => ({
  id: nextId++,
  kind,
  name,
  location: { lat: 55.76, lon: 37.6 },
});

const PLACES = [
  place('metro', 'Тверская'),
  place('metro', 'Арбатская'),
  place('metro', 'Спортивная'),
  place('metro', 'Чистые пруды'),
  place('metro', 'Охотный ряд'),
  place('metro', 'Проспект Мира'),
  place('metro', 'Китай-город'),
  place('district', 'Тверской район'),
  place('district', 'район Арбат'),
  place('district', 'Мещанский район'),
];
const gazetteer = createGazetteer(PLACES);
const parse = (text: string) => parseQuery(text, gazetteer);

describe('place in the query', () => {
  it.each([
    ['бар у метро Тверская', 'metro', 'Тверская'],
    ['бар на Тверской', 'metro', 'Тверская'],
    ['кофе возле м. Тверская', 'metro', 'Тверская'],
    ['кафе у Чистых прудов', 'metro', 'Чистые пруды'],
    ['посидеть у Охотного ряда', 'metro', 'Охотный ряд'],
    ['ресторан на проспекте Мира', 'metro', 'Проспект Мира'],
    ['паб у Китай-города', 'metro', 'Китай-город'],
    ['кафе на Арбате', 'district', 'район Арбат'],
    ['ужин в Мещанском районе', 'district', 'Мещанский район'],
    ['кафе в районе Тверской', 'district', 'Тверской район'],
    ['Арбатская', 'metro', 'Арбатская'],
  ])('finds %s', (text, kind, name) => {
    expect(parse(text).place).toMatchObject({ kind, name });
  });

  it('does not take a common word for a station without a place cue', () => {
    const query = parse('спортивный бар');
    expect(query.place).toBeNull();
    expect(query.category).toBe('бар');
    expect(parse('бар у Спортивной').place).toMatchObject({ name: 'Спортивная' });
  });

  it('keeps an unknown landmark after a cue for geocoding', () => {
    expect(parse('кафе у Большого театра')).toMatchObject({ place: null, placeText: 'Большого театра' });
    expect(parse('бар на Покровке')).toMatchObject({ placeText: 'Покровке' });
    expect(parse('кафе на двоих').placeText).toBeNull();
  });

  it('understands near me without a place', () => {
    expect(parse('кофейня рядом со мной')).toMatchObject({ category: 'кафе', nearMe: true, place: null });
    expect(parse('бар рядом с Тверской')).toMatchObject({ nearMe: false, place: { name: 'Тверская' } });
  });

  it('looks up a place named by the language model', () => {
    expect(gazetteer.lookup('метро Тверская')).toMatchObject({ kind: 'metro', name: 'Тверская' });
    expect(gazetteer.lookup('Арбат')).toMatchObject({ kind: 'district', name: 'район Арбат' });
    expect(gazetteer.lookup('Большой театр')).toBeNull();
  });
});

describe('what the guest wants', () => {
  it('reads the category, mood, company, features and cuisine', () => {
    expect(parse('тихий бар на двоих с верандой и живой музыкой')).toMatchObject({
      category: 'бар',
      mood: 'тихо',
      company: 'вдвоём',
      features: ['веранда', 'живая музыка'],
    });
    expect(parse('суши с друзьями')).toMatchObject({ cuisines: ['суши'], company: 'друзья', category: null });
    expect(parse('поиграть в компьютерный клуб').category).toBe('компьютерный клуб');
    expect(parse('ночной клуб потусить')).toMatchObject({ category: 'клуб', mood: 'шумно' });
    expect(parse('попариться в бане компанией')).toMatchObject({ category: 'баня', company: 'компания' });
    expect(parse('романтичное свидание')).toMatchObject({ mood: 'романтика', company: 'вдвоём' });
  });

  it('does not mistake similar words', () => {
    expect(parse('барбершоп').category).toBeNull();
    expect(parse('другое место').company).toBeNull();
  });

  it.each([
    ['бар до 1500', 1500],
    ['ресторан бюджет 3 000', 3000],
    ['ужин за 5к', 5000],
    ['кафе около 2 тысяч', 2000],
    ['паб 1200 руб', 1200],
    ['недорого поесть', 1000],
    ['бар на 2 человек', null],
  ])('reads the budget in %s', (text, budget) => {
    expect(parse(text).budgetMax).toBe(budget);
  });

  it('tells whether anything was understood', () => {
    expect(recognized(parse('куда бы сходить'))).toBe(false);
    expect(recognized(parse('бар'))).toBe(true);
  });
});
