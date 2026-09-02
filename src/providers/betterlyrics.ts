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
    endtime?: number;
    duration?: number;
    structure?: string;
    text: Array<{ text: string; timestamp: number; endtime: number; part?: boolean }>;
    agent?: string;
    key?: string;
    background?: boolean;
  }>;
  ttmlContent?: string | null;
  elrc?: string | null;
  elrcMultiPerson?: string | null;
  plain?: string | null;
  metadata?: {
    songwriters?: string[];
    language?: string;
    duration?: number;
  };
}

interface KpLyricsResponse {
  type?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
  lyrics?: Array<{
    text: string;
    time: number;
    duration: number;
    syllabus?: Array<{ text: string; time: number; duration: number }>;
  }>;
}

const PAXSENIX = 'https://lyrics.paxsenix.org';
const APPLE_ITUNES = 'https://itunes.apple.com/search';
const BINIMUM = 'https://lyrics-api.binimum.org/api/lookup';
const LP_SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app'
];

export class BetterLyricsProvider implements LyricsProvider {
  public readonly name = 'BetterLyrics';
  private lastServer: string | null = null;

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
    const r = await makeRequest<ItunesSearchResponse>(`${APPLE_ITUNES}?${params}`);
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
    const r = await makeRequest<PaxLyricsResponse>(`${PAXSENIX}/apple-music/lyrics?id=${id}`);
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private contentToLrc(data: PaxLyricsResponse, name: string, artist: string): LyricsTrack | null {
    if (data.ttmlContent) {
      const lrc = ttmlToLrc(data.ttmlContent);
      if (lrc) return { synced: lrc, name, artist, duration: data.metadata?.duration ? Math.round(data.metadata.duration / 1000) : undefined };
    }
    if (data.elrc) return { synced: data.elrc, name, artist };
    if (data.elrcMultiPerson) return { synced: data.elrcMultiPerson, name, artist };
    if (data.plain) return { unsynced: data.plain, name, artist };
    if (data.content?.length) {
      if (data.type === 'Syllable') {
        const lrc = data.content
          .map((line) => {
            const m = Math.floor(line.timestamp / 1000 / 60);
            const s = (line.timestamp / 1000) % 60;
            const text = line.text
              .map((w) => w.text)
              .join('')
              .trim();
            if (!text) return '';
            return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}] ${text}`;
          })
          .filter(Boolean)
          .join('\n');
        if (lrc) return { synced: lrc, name, artist, duration: data.metadata?.duration ? Math.round(data.metadata.duration / 1000) : undefined };
      }
      const plain = data.content
        .map((line) =>
          line.text
            .map((w) => w.text)
            .join('')
            .trim()
        )
        .filter((s) => s)
        .join('\n');
      if (plain) return { unsynced: plain, name, artist };
    }
    return null;
  }

  private kpToLrc(r: KpLyricsResponse): LyricsTrack | null {
    if (r.syncedLyrics) return { synced: r.syncedLyrics, name: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration };
    if (r.plainLyrics) return { unsynced: r.plainLyrics, name: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration };
    if (r.lyrics?.length) {
      const lrc = r.lyrics
        .filter((l) => l.text?.trim())
        .map((l) => {
          const m = Math.floor(l.time / 60_000);
          const s = (l.time - m * 60_000) / 1000;
          return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}] ${l.text}`;
        })
        .join('\n');
      if (lrc) return { synced: lrc, name: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration };
    }
    return null;
  }

  private async binimumLookup(title: string, artist: string, duration?: number): Promise<KpLyricsResponse | null> {
    const body = JSON.stringify({ title, artist, duration: duration || 0 });
    const r = await makeRequest<KpLyricsResponse>(BINIMUM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private async lyricsPlusLookup(title: string, artist: string): Promise<KpLyricsResponse | null> {
    const params = new URLSearchParams({ title, artist });
    const servers = this.lastServer
      ? [this.lastServer, ...LP_SERVERS.filter((s) => s !== this.lastServer)]
      : LP_SERVERS;
    const tasks = servers.map(async (server) => {
      const r = await makeRequest<KpLyricsResponse>(`${server}/v2/lyrics/get?${params}`);
      if (r.error || r.statusCode !== 200 || !r.body) return null;
      if (r.body.syncedLyrics || r.body.plainLyrics || r.body.lyrics?.length) {
        this.lastServer = server;
        return r.body;
      }
      return null;
    });
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) return r.value;
    }
    return null;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    return this.itunesSearch(query);
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const data = await this.paxsenixFetch(trackId);
    if (!data) return null;
    return this.contentToLrc(data, '', '');
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = query.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
    const artist = parts.length > 1 ? parts[0] || '' : '';
    const title = parts.length > 1 ? parts[1] || '' : parts[0] || '';
    const fullQuery = `${title} ${artist}`.trim();

    const results = await this.itunesSearch(fullQuery);
    for (const r of results) {
      const data = await this.paxsenixFetch(r.trackId as number);
      if (!data) continue;
      const track = this.contentToLrc(data, r.name, r.artist);
      if (track) {
        return { ...track, album: r.album, duration: r.duration };
      }
    }

    const lp = await this.lyricsPlusLookup(title, artist);
    if (lp) {
      const track = this.kpToLrc(lp);
      if (track) return track;
    }

    const bini = await this.binimumLookup(title, artist);
    if (bini) {
      const track = this.kpToLrc(bini);
      if (track) return track;
    }

    return null;
  }
}

function ttmlToLrc(ttml: string): string {
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


