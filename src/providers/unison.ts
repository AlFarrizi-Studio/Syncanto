import type { LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { scoreMatch, stripQuery, timeToMs } from '../utils/text';

interface UnisonSearchItem {
  id: number;
  videoId?: string;
  song: string;
  artist: string;
  album?: string;
  duration: number;
  format: 'ttml' | 'lrc' | 'plain';
  language?: string;
  syncType?: string;
  voteCount?: number;
}

interface UnisonSearchResponse {
  success: boolean;
  data?: UnisonSearchItem[];
}

interface UnisonLyricsResponse {
  success: boolean;
  data?: {
    id: number;
    song: string;
    artist: string;
    album?: string;
    lyrics: string;
    format: 'ttml' | 'lrc' | 'plain';
    syncType?: string;
  };
}

const BASE = 'https://unison.boidu.dev';
const KEY_ID = 'SyncantoTS';

export class UnisonProvider implements LyricsProvider {
  public readonly name = 'Unison';

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
      void endMs;
      out.push(`[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${text}`);
    }
    return out.join('\n');
  }

  private async fetchById(id: number): Promise<UnisonLyricsResponse | null> {
    const r = await makeRequest<UnisonLyricsResponse>(`${BASE}/lyrics/${id}`, {
      headers: { 'x-key-id': KEY_ID }
    });
    if (r.error || r.statusCode !== 200 || !r.body?.success || !r.body.data) return null;
    return r.body;
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const title = parts.title || query;
    const artist = parts.artist || '';

    const strategies: string[] = [];
    strategies.push(`?q=${encodeURIComponent(query)}`);
    strategies.push(`?q=${encodeURIComponent(`${title} ${artist}`.trim())}`);

    let bestPick: { id: number; song: string; artist: string; score: number; duration: number; album?: string } | null = null;

    for (const strat of strategies) {
      const r = await makeRequest<UnisonSearchResponse | UnisonLyricsResponse>(
        `${BASE}/lyrics/search${strat}`,
        { headers: { 'x-key-id': KEY_ID } }
      );
      if (r.error || r.statusCode !== 200 || !r.body || !r.body.success) continue;

      const items: UnisonSearchItem[] = Array.isArray((r.body as UnisonSearchResponse).data)
        ? ((r.body as UnisonSearchResponse).data as UnisonSearchItem[])
        : [];

      for (const item of items) {
        const target = `${title} ${artist}`.toLowerCase().trim() || query.toLowerCase();
        const candidateText = `${item.song} ${item.artist}`.toLowerCase();
        const matchScore = scoreMatch(candidateText, target);
        let score = matchScore;
        if (artist && item.artist.toLowerCase().includes(artist.toLowerCase())) score += 25;
        if (title) {
          const titleLc = title.toLowerCase().split(/\s+/)[0] || '';
          if (titleLc && item.song.toLowerCase().includes(titleLc)) score += 20;
        }
        const confidenceBoost =
          item.syncType === 'richsync' ? 5
          : item.syncType === 'linesync' ? 3
          : 0;
        score += confidenceBoost + Math.min(item.voteCount || 0, 10) * 0.5;
        if (score < 30) continue;
        const candidate = {
          id: item.id,
          song: item.song,
          artist: item.artist,
          score,
          duration: item.duration,
          album: item.album
        };
        if (!bestPick || candidate.score > bestPick.score) {
          bestPick = candidate;
        }
      }
      if (bestPick) break;
    }

    if (!bestPick) {
      log('debug', this.name, `no match for: ${query}`);
      return null;
    }

    const lyrics = await this.fetchById(bestPick.id);
    if (!lyrics?.data) return null;
    const payload = lyrics.data;
    if (payload.format === 'ttml') {
      const lrc = this.ttmlToLrc(payload.lyrics);
      if (lrc) {
        return {
          synced: lrc,
          name: payload.song,
          artist: payload.artist,
          album: payload.album,
          duration: bestPick.duration
        };
      }
    } else if (payload.format === 'lrc') {
      return {
        synced: payload.lyrics,
        name: payload.song,
        artist: payload.artist,
        album: payload.album,
        duration: bestPick.duration
      };
    }
    return {
      unsynced: payload.lyrics,
      name: payload.song,
      artist: payload.artist,
      album: payload.album,
      duration: bestPick.duration
    };
  }
}




