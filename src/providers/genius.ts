import type { LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery } from '../utils/text';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class GeniusProvider implements LyricsProvider {
  public readonly name = 'Genius';

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(_query: string): Promise<never[]> {
    return [];
  }

  public async getById(_trackId: string | number): Promise<LyricsTrack | null> {
    return null;
  }

  private toSlug(title: string, artist: string): string[] {
    const slugBase = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9']+/g, '-')
        .replace(/'+/g, '')
        .replace(/^-+|-+$/g, '');

    const stripFeat = (s: string): string => s.replace(/\s*[\(\[]\s*(feat\.?|featuring|ft\.?)\s+[^\)\]]+[\)\]]/gi, '').trim();

    const t = slugBase(stripFeat(title));
    const a = slugBase(artist);
    const tNoParens = slugBase(stripFeat(title).split(/\s+/)[0] || '');
    const candidates: string[] = [];
    if (t && a) {
      candidates.push(`${a}-${t}-lyrics`);
      candidates.push(`${a}-${t}`);
    } else if (t) {
      candidates.push(`${t}-lyrics`);
    }
    if (tNoParens && a && tNoParens !== t) {
      candidates.push(`${a}-${tNoParens}-lyrics`);
    }
    return candidates;
  }

  private extractLyrics(html: string): string | null {
    const re = /window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\((["'][\s\S]+?["'])\);\s*<\/script>/;
    const m = html.match(re);
    if (!m) return null;
    const code = m[1];
    if (!code) return null;
    try {
      const fn = new Function('return JSON.parse(' + code + ')');
      const state = fn();

      // Walk state looking for `body.html` under a `lyricsData` ancestor
      const findLyricsHtml = (node: unknown, depth = 0): string | null => {
        if (depth > 8 || node === null || typeof node !== 'object') return null;
        const obj = node as Record<string, unknown>;
        if (
          typeof obj.html === 'string' &&
          obj.html.includes('<') &&
          (obj.html.includes('Verse') || obj.html.includes('Chorus') || obj.html.includes('['))
        ) {
          return obj.html;
        }
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v && typeof v === 'object') {
            const found = findLyricsHtml(v, depth + 1);
            if (found) return found;
          }
        }
        return null;
      };

      const html = findLyricsHtml(state);
      if (!html) return null;

      // Strip HTML but preserve <br> as newlines
      const text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'");

      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (!lines.length) return null;
      return lines.join('\n');
    } catch {
      return null;
    }
  }

  private consecutiveFails = 0;
  private static FAIL_THRESHOLD = 4;
  private static backoffUntil = 0;

  private async fetchSongPage(slug: string): Promise<string | null> {
    if (GeniusProvider.backoffUntil > Date.now()) {
      log('debug', this.name, `backing off until ${new Date(GeniusProvider.backoffUntil).toISOString()}`);
      return null;
    }
    const variants = [`https://genius.com/${slug}`, `https://genius.com/${capitalize(slug)}`];
    for (const url of variants) {
      const r = await makeRequest<string>(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'upgrade-insecure-requests': '1'
        }
      });
      if (r.statusCode === 403 || r.statusCode === 429) {
        this.consecutiveFails++;
        if (this.consecutiveFails >= GeniusProvider.FAIL_THRESHOLD) {
          GeniusProvider.backoffUntil = Date.now() + 5 * 60_000;
          log('debug', this.name, `rate-limited, backing off 5 min`);
        }
        continue;
      }
      if (r.error || r.statusCode !== 200) continue;
      const body = typeof r.body === 'string' ? r.body : '';
      if (body.includes('"cf-mitigated"') || /class="[^"]*challenge/i.test(body) || body.length < 5000) continue;
      this.consecutiveFails = 0;
      if (!body.includes('window.__PRELOADED_STATE__')) continue;
      return body;
    }
    return null;
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const title = parts.title || query;
    const artist = parts.artist || '';
    const slugs = this.toSlug(title, artist);

    for (const slug of slugs) {
      const html = await this.fetchSongPage(slug);
      if (!html) continue;
      const lyrics = this.extractLyrics(html);
      if (lyrics) {
        const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        const artistMatch = html.match(/<meta property="og:description" content="Lyrics for[^"]*by ([^"]+)"/);
        return {
          unsynced: lyrics,
          name: nameMatch ? decodeHtml(nameMatch[1] || '').replace(/ Lyrics.*$/i, '').trim() : title,
          artist: artistMatch ? decodeHtml(artistMatch[1] || '').trim() : artist
        };
      }
    }
    log('debug', this.name, `no match for: ${query}`);
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'");
}

function capitalize(slug: string): string {
  if (!slug) return slug;
  const idx = slug.indexOf('-');
  if (idx < 0) return slug;
  return slug.slice(0, 1).toUpperCase() + slug.slice(1);
}

void htmlEscape;
