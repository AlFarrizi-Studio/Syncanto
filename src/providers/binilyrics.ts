import type { LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { timeToMs } from '../utils/text';

interface BlSearchItem {
  id: string;
  track_name: string;
  artist_name: string;
  album_name?: string;
  duration: number;
  isrc?: string;
  timing_type: 'word' | 'line' | 'none';
  lyricsUrl?: string;
}

interface BlSearchResponse {
  total: number;
  results: BlSearchItem[];
}

const SEARCH = 'https://lyrics-api.binimum.org/getLyrics';
const STORAGE = 'https://lyrics-storage.binimum.org';

export class BiniLyricsProvider implements LyricsProvider {
  public readonly name = 'BiniLyrics';

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(_query: string): Promise<never[]> {
    return [];
  }

  public async getById(_trackId: string | number): Promise<LyricsTrack | null> {
    return null;
  }

  private ttmlToLrc(ttml: string): string {
    const out: string[] = [];
    const pRe = /<p\s+([^>]*)?>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(ttml)) !== null) {
      const attrs = m[1] || '';
      const body = m[2] || '';
      const beginMatch = attrs.match(/begin="([^"]+)"/);
      const endMatch = attrs.match(/end="([^"]+)"/);
      if (!beginMatch) continue;
      const beginMs = timeToMs(beginMatch[1] || '0');
      const endMs = endMatch ? timeToMs(endMatch[1] || '0') : beginMs;

      const text = body
        .replace(/<span[^>]*>/g, '')
        .replace(/<\/span>/g, ' ')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (!text) continue;

      const minutes = Math.floor(beginMs / 60_000);
      const seconds = (beginMs - minutes * 60_000) / 1000;
      const dur = endMs - beginMs;
      void dur;
      out.push(`[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${text}`);
    }
    return out.join('\n');
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const r = await makeRequest<BlSearchResponse>(`${SEARCH}?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (r.error || r.statusCode !== 200 || !r.body?.results?.length) {
      log('debug', this.name, `no match for: ${query}`);
      return null;
    }

    const top = r.body.results[0];
    if (!top?.lyricsUrl) return null;

    const ttmlResp = await makeRequest<string>(top.lyricsUrl.startsWith('http') ? top.lyricsUrl : `${STORAGE}/${top.lyricsUrl}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (ttmlResp.error || ttmlResp.statusCode !== 200 || !ttmlResp.body) return null;
    const ttml = String(ttmlResp.body);
    if (!ttml.includes('<tt')) return null;

    return {
      synced: this.ttmlToLrc(ttml),
      name: top.track_name,
      artist: top.artist_name,
      album: top.album_name,
      duration: top.duration
    };
  }
}


