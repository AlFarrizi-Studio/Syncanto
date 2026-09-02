import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { decodeEntities } from '../utils/text';

interface QqSmartboxResponse {
  status: number;
  code: number;
  data: {
    song: {
      itemlist?: Array<{
        songname: string;
        singer: Array<{ name: string }>;
        albumname_hilight?: string;
        albumname?: string;
        interval: number;
        songid: number;
        songmid: string;
      }>;
      songlist?: Array<{
        songname: string;
        singer: Array<{ name: string }>;
        albumname_hilight?: string;
        albumname?: string;
        interval: number;
        songid: number;
        songmid: string;
      }>;
    };
  };
}

interface QqLyricResponse {
  retcode: number;
  code: number;
  subcode: number;
  lyric?: string;
  trans?: string;
}

const SEARCH = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const LYRIC = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

export class QQMusicProvider implements LyricsProvider {
  public readonly name = 'QQMusic';

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const params = new URLSearchParams({
      key: query,
      format: 'json',
      outCharset: 'utf-8',
      platform: 'yqq',
      needNewCode: '0'
    });
    const r = await makeRequest<QqSmartboxResponse>(`${SEARCH}?${params}`, {
      headers: { Referer: 'https://y.qq.com/' }
    });
    if (r.error || r.statusCode !== 200 || !r.body?.data?.song) {
      log('debug', this.name, `search failed: ${r.error || r.statusCode}`);
      return [];
    }
    const items = r.body.data.song.itemlist || r.body.data.song.songlist || [];
    return items.map((s) => ({
      provider: this.name,
      name: (s as Record<string, unknown>).name as string || s.songname,
      artist: typeof s.singer === 'string' ? s.singer : s.singer.map((x) => x.name).join(', '),
      album: s.albumname,
      duration: s.interval,
      trackId: (s as Record<string, unknown>).mid as string || s.songmid
    }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const params = new URLSearchParams({
      songmid: String(trackId),
      format: 'json',
      outCharset: 'utf-8',
      platform: 'yqq',
      needNewCode: '0',
      callback: 'MusicJsonCallback'
    });
    const r = await makeRequest<unknown>(`${LYRIC}?${params}`, {
      headers: { Referer: 'https://y.qq.com/' }
    });
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    let raw: unknown = r.body;
    if (typeof raw === 'string') {
      raw = raw.replace(/^MusicJsonCallback\(/, '').replace(/\);?$/, '').trim();
    }
    try {
      const parsed = typeof raw === 'string' ? (JSON.parse(raw) as QqLyricResponse) : (raw as QqLyricResponse);
      if (parsed.code !== 0 || !parsed.lyric) return null;
      let lyric = parsed.lyric;
      try {
        const decoded = Buffer.from(lyric, 'base64').toString('utf-8');
        if (/\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(decoded) || /\[(ti|ar|al|by|offset):/.test(decoded)) {
          lyric = decoded;
        }
      } catch {
        /* not base64 */
      }
      lyric = decodeEntities(lyric);
      return {
        synced: /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(lyric) ? lyric : undefined,
        unsynced: /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(lyric) ? undefined : lyric
      };
    } catch {
      return null;
    }
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const results = await this.search(query);
    const top = results[0];
    if (!top?.trackId) return null;
    const track = await this.getById(top.trackId);
    if (!track) return null;
    return { ...track, name: top.name, artist: top.artist, album: top.album, duration: top.duration };
  }
}
