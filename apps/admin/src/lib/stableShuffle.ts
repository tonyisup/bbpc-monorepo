/** A 32-bit FNV-1a hash with a final mix, so similar keys land far apart. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * A random-looking order that stays the same for the same seed: it doesn't
 * depend on the input order, and adding an item never reorders the others.
 */
export function stableShuffle<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  seed: string
): T[] {
  return items
    .map((item) => {
      const key = keyOf(item);
      return { item, key, rank: hash(`${seed}:${key}`) };
    })
    .sort((left, right) =>
      left.rank === right.rank
        ? left.key.localeCompare(right.key)
        : left.rank - right.rank
    )
    .map(({ item }) => item);
}
