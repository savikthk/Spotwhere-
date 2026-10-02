const MIN_STEM_LENGTH = 2;

const ENDINGS =
  'ами ями ого его ому ему ыми ими ей ой ый ий ым им ая яя ое ее ые ие ую юю ом ем ам ям ах ях ов ев ых их ью а я о е ы и у ю ь й'
    .split(' ')
    .sort((left, right) => right.length - left.length);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

export function stem(word: string): string {
  const ending = ENDINGS.find(
    (candidate) => word.endsWith(candidate) && word.length - candidate.length >= MIN_STEM_LENGTH,
  );
  return ending === undefined ? word : word.slice(0, -ending.length);
}

export function stems(text: string): string[] {
  return words(text).map(stem);
}

export function nameKey(name: string): string {
  return words(name).join(' ');
}

export function findSequence(haystack: readonly string[], needle: readonly string[], from = 0): number {
  if (needle.length === 0) return -1;
  for (let start = from; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((part, offset) => haystack[start + offset] === part)) return start;
  }
  return -1;
}
