import type { LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery } from '../utils/text';

interface LyricsOvhResponse {
  lyrics?: string;
  error?: string;
}

const API = 'https://api.lyrics.ovh/v1';

export class LyricsOvhProvider implements LyricsProvider {
  public readonly name = 'LyricsOvh';

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(_query: string): Promise<never[]> {
    return [];
  }

  public async getById(_trackId: string | number): Promise<LyricsTrack | null> {
    return null;
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const tokens = query.split(/\s+/);
    const variants: Array<[string, string]> = [];
    if (parts.artist && parts.title) {
      variants.push([parts.artist, parts.title]);
    }
    if (tokens.length >= 2) {
      variants.push([tokens[0] || '', tokens.slice(1).join(' ')]);
      variants.push([tokens.slice(0, -1).join(' '), tokens[tokens.length - 1] || '']);
    }
    for (const [artist, title] of variants) {
      if (!artist || !title) continue;
      const url = `${API}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const r = await makeRequest<LyricsOvhResponse>(url);
      if (r.error || r.statusCode !== 200 || !r.body?.lyrics) continue;
      const text = r.body.lyrics.replace(/\r/g, '').trim();
      return { unsynced: text, name: title, artist };
    }
    log('debug', this.name, `no match for: ${query}`);
    return null;
  }
}
