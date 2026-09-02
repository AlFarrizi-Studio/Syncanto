import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { makeRequest } from '../utils/http';
import { timeToMs } from '../utils/text';

interface ItunesSearchResponse {
  resultCount: number;
  results: Array<{
    trackId: number;
    trackName: string;
    artistName: string;
    collectionName?: string;
    trackTimeMillis: number;
  }>;
}

interface PaxLyricsResponse {
  type: 'Syllable' | 'Line' | 'None';
  content?: Array<{
    timestamp: number;
    background?: boolean;
    text: Array<{ text: string; timestamp: number; endtime: number }>;
  }>;
  ttmlContent?: string | null;
  elrc?: string | null;
  elrcMultiPerson?: string | null;
  plain?: string | null;
  metadata?: { duration?: number };
}

const PAXSENIX = 'https://lyrics.paxsenix.org';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

export class AppleMusicProvider implements LyricsProvider {
  public readonly name = 'AppleMusic';

  public async setup(): Promise<boolean> {
    return true;
  }

  private async itunesSearch(query: string): Promise<LyricsSearchResult[]> {
    const params = new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '5'
    });
    const r = await makeRequest<ItunesSearchResponse>(`${ITUNES_SEARCH}?${params}`);
    if (r.error || r.statusCode !== 200 || !r.body?.results) return [];
    return r.body.results.map((t) => ({
      provider: this.name,
      name: t.trackName,
      artist: t.artistName,
      album: t.collectionName,
      duration: Math.round(t.trackTimeMillis / 1000),
      trackId: t.trackId
    }));
  }

  private async paxsenixFetch(id: string | number): Promise<PaxLyricsResponse | null> {
    const r = await makeRequest<PaxLyricsResponse>(`${PAXSENIX}/apple-music/lyrics?id=${encodeURIComponent(String(id))}`);
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private ttmlToLrc(ttml: string): string {
    const out: string[] = [];
    const pRe = /<p\s+([^>]*)?>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(ttml)) !== null) {
      const attrs = m[1] || '';
      const body = m[2] || '';
      const beginMatch = attrs.match(/begin="([^"]+)"/);
      if (!beginMatch) continue;
      const beginMs = timeToMs(beginMatch[1] || '0');
      const text = body
        .replace(/<span[^>]*>/g, '')
        .replace(/<\/span>/g, '')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (!text) continue;
      const minutes = Math.floor(beginMs / 60_000);
      const seconds = (beginMs - minutes * 60_000) / 1000;
      out.push(`[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${text}`);
    }
    return out.join('\n');
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const data = await this.paxsenixFetch(trackId);
    if (!data) return null;
    if (data.ttmlContent) {
      const lrc = this.ttmlToLrc(data.ttmlContent);
      if (lrc) return { synced: lrc };
    }
    if (data.elrc) return { synced: data.elrc };
    if (data.elrcMultiPerson) return { synced: data.elrcMultiPerson };
    if (data.plain) return { unsynced: data.plain };
    if (data.content?.length) {
      if (data.type === 'Syllable') {
        const lrc = data.content
          .map((line) => {
            const minutes = Math.floor(line.timestamp / 60_000);
            const seconds = (line.timestamp - minutes * 60_000) / 1000;
            const text = line.text.map((w) => w.text).join('').trim();
            if (!text) return '';
            return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${text}`;
          })
          .filter(Boolean)
          .join('\n');
        return { synced: lrc };
      }
      const plain = data.content
        .map((line) => line.text.map((w) => w.text).join('').trim())
        .filter((s) => s)
        .join('\n');
      return { unsynced: plain };
    }
    return null;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    return this.itunesSearch(query);
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const results = await this.itunesSearch(query);
    for (const r of results.slice(0, 5)) {
      if (!r.trackId) continue;
      const track = await this.getById(r.trackId);
      if (track) {
        return { ...track, name: r.name, artist: r.artist, album: r.album, duration: r.duration };
      }
    }
    return null;
  }
}


