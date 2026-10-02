const BASELINE: Record<string, readonly [mood: string, company: string]> = {
  бар: ['шумно', 'компания'],
  паб: ['шумно', 'друзья'],
  ресторан: ['романтика', 'вдвоём'],
  кафе: ['тихо', 'вдвоём'],
  быстро: ['шумно', 'один'],
  клуб: ['шумно', 'компания'],
  кальянная: ['тихо', 'компания'],
  'компьютерный клуб': ['шумно', 'друзья'],
  кино: ['тихо', 'вдвоём'],
  баня: ['тихо', 'компания'],
  спа: ['тихо', 'вдвоём'],
  боулинг: ['шумно', 'компания'],
  квест: ['шумно', 'компания'],
  'батутный центр': ['шумно', 'компания'],
  танцы: ['шумно', 'компания'],
  'игровые автоматы': ['шумно', 'друзья'],
  аквапарк: ['шумно', 'компания'],
};
const MOODS = ['тихо', 'шумно', 'романтика'];
const COMPANIES = ['вдвоём', 'компания', 'друзья', 'один'];

export function withBaseline(tags: readonly string[]): string[] {
  const category = Object.keys(BASELINE).find((name) => tags.includes(name)) ?? 'кафе';
  const [mood, company] = BASELINE[category] ?? ['тихо', 'вдвоём'];
  const result = [...new Set(tags)];
  if (!result.some((tag) => MOODS.includes(tag))) result.push(mood);
  if (!result.some((tag) => COMPANIES.includes(tag))) result.push(company);
  return result;
}
