const BOUNDARY = '/._- ';

export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  const baseStart = t.lastIndexOf('/') + 1;
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const idx = t.indexOf(ch, from);
    if (idx < 0) return null;
    if (idx === prev + 1) score += 5;
    if (idx === 0 || BOUNDARY.includes(t[idx - 1])) score += 8;
    if (idx >= baseStart) score += 2;
    prev = idx;
    from = idx + 1;
  }
  return score - t.length * 0.01;
}

export function fuzzyFilter(query: string, items: string[], limit = 50): string[] {
  if (!query) return items.slice(0, limit);
  const scored: { item: string; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, item);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
