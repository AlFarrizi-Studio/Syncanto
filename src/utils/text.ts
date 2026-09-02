import type { LyricsLine } from '../types';

const TAG_PATTERN = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(lrc: string): LyricsLine[] {
  if (!lrc) return [];
  const lines: LyricsLine[] = [];
  const rawLines = lrc.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const matches: number[] = [];
    let match: RegExpExecArray | null;
    TAG_PATTERN.lastIndex = 0;

    while ((match = TAG_PATTERN.exec(rawLine)) !== null) {
      const minutes = Number.parseInt(match[1] || '0', 10);
      const seconds = Number.parseInt(match[2] || '0', 10);
      const fractionRaw = match[3] || '0';
      const fraction = Number.parseInt(fractionRaw.padEnd(3, '0').slice(0, 3), 10);
      const total = minutes * 60_000 + seconds * 1000 + fraction;
      matches.push(total);
    }

    if (matches.length === 0) continue;

    const text = rawLine.replace(TAG_PATTERN, '').trim();
    if (!text) continue;

    for (const time of matches) {
      lines.push({ text, time, duration: 0 });
    }
  }

  lines.sort((a, b) => a.time - b.time);

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    if (current && next && next.time > current.time) {
      current.duration = next.time - current.time;
    }
  }

  return lines;
}

export function isSyncedLrc(lrc: string): boolean {
  if (!lrc) return false;
  const sample = lrc.split(/\r?\n/).slice(0, 10);
  return sample.some((line) => /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(line));
}

export function stripQuery(query: string): { artist: string | null; title: string } {
  const separators = [' - ', ' – ', ' — ', ' ~ '];
  let cleaned = query.trim();

  for (const sep of separators) {
    const idx = cleaned.indexOf(sep);
    if (idx > 0 && idx < cleaned.length - sep.length) {
      const artist = cleaned.slice(0, idx).trim();
      const title = cleaned.slice(idx + sep.length).trim();
      if (artist && title) return { artist, title };
    }
  }

  return { artist: null, title: cleaned };
}

export function cleanTitle(text: string): string {
  return text
    .replace(/\s*\([^)]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|prod\.)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|prod\.)[^\]]*\]/gi, '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*[([]\s*(?:ft\.?|feat\.?|featuring)\s+[^)\]]+[)\]]/gi, '')
    .trim();
}

export function scoreMatch(a: string, b: string): number {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 75;

  const leftTokens = new Set(left.split(/\s+/));
  const rightTokens = new Set(right.split(/\s+/));
  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common++;
  }
  const denom = Math.max(leftTokens.size, rightTokens.size) || 1;
  return Math.round((common / denom) * 60);
}

export function bestMatch<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  minScore = 50
): T | null {
  if (!items.length) return null;
  const sorted = [...items].sort(
    (a, b) => scoreMatch(key(b), query) - scoreMatch(key(a), query)
  );
  const top = sorted[0];
  if (!top) return null;
  if (scoreMatch(key(top), query) < minScore) return null;
  return top;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

export function timeToMs(t: string): number {
  const parts = t.split(':');
  if (parts.length === 3) {
    const h = Number.parseFloat(parts[0] || '0');
    const m = Number.parseFloat(parts[1] || '0');
    const s = Number.parseFloat(parts[2] || '0');
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number.parseFloat(parts[0] || '0');
    const s = Number.parseFloat(parts[1] || '0');
    return Math.round((m * 60 + s) * 1000);
  }
  return Math.round(Number.parseFloat(parts[0] || '0') * 1000);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9']+/g, '-')
    .replace(/'+/g, '')
    .replace(/^-+|-+$/g, '');
}
