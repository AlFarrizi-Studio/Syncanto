import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';

interface NetEaseSearchResponse {
  result: {
    songs?: Array<{
      id: number;
      name: string;
      artists?: Array<{ id: number; name: string }>;
      album?: { name: string; id: number };
      duration?: number;
    }>;
  };
}

interface NetEaseLyricsResponse {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  klyric?: { lyric?: string };
}

const API_SEARCH = 'https://music.163.com/api/search/pc';
const API_LYRICS = 'https://music.163.com/api/song/lyric';

const DEFAULT_COOKIE =
  'NMTID=00OAVK3xqDG726ITU6jopU6jF2yMk0AAAGCO8l1BA; JSESSIONID-WYYY=8KQo11YK2GZP45RMlz8Kn80vHZ9%2FGvwzRKQXXy0iQoFKycWdBlQjbfT0MJrFa6hwRfmpfBYKeHliUPH287JC3hNW99WQjrh9b9RmKT%2Fg1Exc2VwHZcsqi7ITxQgfEiee50po28x5xTTZXKoP%2FRMctN2jpDeg57kdZrXz%2FD%2FWghb%5C4DuZ%3A1659124633932; _iuqxldmzr_=32; _ntes_nnid=0db6667097883aa9596ecfe7f188c3ec,1659122833973; _ntes_nuid=0db6667097883aa9596ecfe7f188c3ec; WNMCID=xygast.1659122837568.01.0; WEVNSM=1.0.0;';

export class NetEaseProvider implements LyricsProvider {
  public readonly name = 'NetEase';
  private sessionCookies = '';

  public async setup(): Promise<boolean> {
    return true;
  }

  private cookieHeader(): string {
    return this.sessionCookies || DEFAULT_COOKIE;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const params = new URLSearchParams({
      limit: '10',
      type: '1',
      offset: '0',
      s: query
    });

    const response = await makeRequest<NetEaseSearchResponse>(
      `${API_SEARCH}?${params.toString()}`,
      {
        headers: {
          Cookie: this.cookieHeader(),
          Referer: 'https://music.163.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    if (response.headers['set-cookie']) {
      this.sessionCookies = response.headers['set-cookie']
        .split(',')
        .map((c) => c.split(';')[0])
        .filter(Boolean)
        .join('; ');
    }

    if (response.error || response.statusCode !== 200) {
      log('debug', this.name, `search failed: ${response.error || response.statusCode}`);
      return [];
    }

    const songs = response.body?.result?.songs;
    if (!songs?.length) return [];

    return songs.map((song) => ({
      provider: this.name,
      name: song.name,
      artist: song.artists?.[0]?.name || 'Unknown',
      album: song.album?.name,
      duration: song.duration,
      trackId: song.id
    }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const params = new URLSearchParams({
      id: String(trackId),
      lv: '1',
      kv: '1',
      tv: '1'
    });

    const response = await makeRequest<NetEaseLyricsResponse>(
      `${API_LYRICS}?${params.toString()}`,
      {
        headers: {
          Cookie: this.cookieHeader(),
          Referer: 'https://music.163.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    if (response.error || response.statusCode !== 200) return null;

    const lyric = response.body?.lrc?.lyric || response.body?.tlyric?.lyric;
    if (!lyric) return null;

    return {
      synced: /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(lyric) ? lyric : undefined,
      unsynced: /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(lyric) ? undefined : lyric
    };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const results = await this.search(query);
    const top = results[0];
    if (!top?.trackId) return null;
    const track = await this.getById(top.trackId);
    if (!track) return null;
    return {
      ...track,
      name: top.name,
      artist: top.artist,
      album: top.album,
      duration: top.duration
    };
  }
}
