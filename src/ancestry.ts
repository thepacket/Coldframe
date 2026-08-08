// Admixture groups from AraCLIM, and colours for them.
//
// These are deliberately unlike every other ramp in the app. Genotype, climate
// and expression are all ordered encodings; ancestry is categorical, and
// painting it in the same visual language would imply an order that isn't
// there. Muted earth tones, so the strip reads as context rather than data.

const PALETTE: Record<string, string> = {
  Admixed: '#7d7a75', // grey, because mixed is the absence of a group
  Asia: '#b98fb0',
  CentralEurope: '#7fa8c9',
  Germany: '#6f8f9c',
  NorthSweden: '#9fc4d8',
  SouthSweden: '#8fae7f',
  WesternEurope: '#a3b56b',
  italy_balkan_caucasus: '#c98f6b',
  relict: '#c47b7b',
  spain: '#d4b483',
  unknown: '#4c4a47',
};

// Anything AraCLIM adds later still gets a stable colour rather than none.
const FALLBACK = ['#9a9ac4', '#c9a26b', '#7fb0a3', '#b58f8f', '#8f9ab5'];

export function ancestryColor(group: string): string {
  const known = PALETTE[group];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = (hash * 31 + group.charCodeAt(i)) >>> 0;
  return FALLBACK[hash % FALLBACK.length] as string;
}

/** `italy_balkan_caucasus` reads badly in a legend. */
export function ancestryLabel(group: string): string {
  return group
    .replace(/_/g, ' / ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Groups present, commonest first, so the legend leads with what dominates. */
export function ancestryOrder(groups: string[]): string[] {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
