import type { LyricsLine, LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';

interface LpKpoeResponse {
  KpoeTools?: string;
  type?: 'Line' | 'Word' | 'Syllable' | 'plain' | string;
  metadata?: {
    source?: string;
    songWriters?: string[];
    title?: string;
    language?: string;
    agents?: Record<string, { type?: string; name?: string; alias?: string }>;
    songParts?: Array<{ name: string; time?: number; duration?: number }>;
    totalDuration?: string;
  };
  lyrics?: Array<{
    time?: number;
    duration?: number;
    text?: string;
    syllabus?: Array<{
      text?: string;
      time?: number;
      duration?: number;
      isBackground?: boolean;
    }>;
    element?: { key?: string; singer?: string; songPartIndex?: number };
  }>;
  syncedLyrics?: string;
  plainLyrics?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
}

const SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyrics-plus-backend.vercel.app',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev'
];

export class YouLyPlusProvider implements LyricsProvider {
  public readonly name = 'YouLyPlus';
  private lastServer: string | null = null;

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(_query: string): Promise<never[]> {
    return [];
  }

  public async getById(_trackId: string | number): Promise<LyricsTrack | null> {
    return null;
  }

  private kpoeToLrc(payload: LpKpoeResponse): { lrc: string; name?: string; artist?: string; album?: string; duration?: number; word: boolean } | null {
    if (!payload?.lyrics?.length) return null;
    const lines: LyricsLine[] = [];
    let word = false;
    for (const line of payload.lyrics) {
      if (!line.text) continue;
      const time = typeof line.time === 'number' ? line.time : 0;
      const duration = typeof line.duration === 'number' ? line.duration : 0;
      if (line.syllabus?.length) {
        word = true;
        const obj: LyricsLine & { syllabus?: unknown } = { text: line.text, time, duration };
        obj.syllabus = line.syllabus;
        lines.push(obj);
      } else {
        lines.push({ text: line.text, time, duration });
      }
    }
    if (!lines.length) return null;
    const lrc = lines
      .map((l) => {
        const m = Math.floor((l.time || 0) / 60_000);
        const s = ((l.time || 0) - m * 60_000) / 1000;
        return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}] ${l.text}`;
      })
      .join('\n');
    return {
      lrc,
      word,
      name: payload.metadata?.title || payload.trackName,
      artist: payload.artistName,
      album: payload.albumName,
      duration: payload.duration
    };
  }

  private async fetchFrom(server: string, title: string, artist?: string): Promise<LpKpoeResponse | null> {
    const params = new URLSearchParams();
    params.set('title', title);
    if (artist) params.set('artist', artist);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const r = await makeRequest<LpKpoeResponse>(`${server}/v2/lyrics/get?${params}`, {
        signal: controller.signal,
        timeout: 6000
      });
      if (r.error || r.statusCode !== 200 || !r.body) return null;
      return r.body;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const order = this.lastServer
      ? [this.lastServer, ...SERVERS.filter((s) => s !== this.lastServer)]
      : SERVERS;

    const variants: Array<[string, string?]> = [];
    const parts = query.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
    if (parts.length > 1) {
      variants.push([parts[1] || '', parts[0] || '']);
    }
    if (!variants.length) {
      const tokens = query.split(/\s+/);
      if (tokens.length >= 2) {
        variants.push([tokens.slice(1).join(' '), tokens[0] || '']);
      }
      variants.push([query]);
    }

    for (const [title, artist] of variants) {
      const results = await Promise.all(
        order.map(async (server) => {
          const r = await this.fetchFrom(server, title, artist);
          if (!r) return null;
          if (r.syncedLyrics?.trim()) {
            return { server, lrc: r.syncedLyrics, name: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration };
          }
          if (r.plainLyrics?.trim()) {
            return { server, lrc: r.plainLyrics, plain: true, name: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration };
          }
          const kpoe = this.kpoeToLrc(r);
          if (!kpoe) return null;
          return { server, lrc: kpoe.lrc, name: kpoe.name, artist: kpoe.artist, album: kpoe.album, duration: kpoe.duration };
        })
      );

      const hit = results.find((r): r is NonNullable<typeof r> => r !== null);
      if (hit) {
        this.lastServer = hit.server;
        const raw = hit.lrc;
        const isLrc = /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(raw);
        return {
          synced: isLrc ? raw : undefined,
          unsynced: isLrc ? undefined : raw,
          name: hit.name,
          artist: hit.artist,
          album: hit.album,
          duration: hit.duration
        };
      }
    }

    log('debug', this.name, `no match for: ${query}`);
    return null;
  }
}
