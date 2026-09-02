import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { makeRequest } from '../utils/http';

interface KgSearchSongResponse {
  status: number;
  errcode: number;
  error?: string;
  data?: {
    info: Array<{ hash: string; duration: number; songname?: string; singername?: string }>;
  };
}

interface KgSearchLyricsResponse {
  status: number;
  candidates: Array<{ id: number; accesskey: string; duration: number }>;
}

interface KgDownloadResponse {
  status: number;
  content: string;
}

const SEARCH_SONG = 'https://mobileservice.kugou.com/api/v3/search/song';
const SEARCH_LYRICS = 'https://lyrics.kugou.com/search';
const DOWNLOAD_LRC = 'https://lyrics.kugou.com/download';

function normalizeTitle(t: string): string {
  return t
    .replace(/\(.*?\)/g, '')
    .replace(/（.*?）/g, '')
    .replace(/「.*?」/g, '')
    .replace(/『.*?』/g, '')
    .replace(/<.*?>/g, '')
    .replace(/《.*?》/g, '')
    .trim();
}

function normalizeArtist(a: string): string {
  return a.replace(/, /g, '、').replace(/ & /g, '、').replace(/\./g, '').replace(/和/g, '、').trim();
}

function normalizeLrc(raw: string): string {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const timeRe = /^\[(\d{1,2}):(\d{1,2})\.(\d{2,3})\]/;
  const banRe = /.+].+[:：].+/;
  const accepted = lines.filter((l) => timeRe.test(l));

  if (accepted.length === 0) return raw;

  let headCut = 0;
  for (let i = Math.min(30, accepted.length - 1); i >= 0; i--) {
    if (banRe.test(accepted[i] || '')) {
      headCut = i + 1;
      break;
    }
  }
  let tailCut = 0;
  for (let i = 0; i < Math.min(30, accepted.length); i++) {
    if (banRe.test(accepted[accepted.length - 1 - i] || '')) {
      tailCut = i + 1;
      break;
    }
  }
  return accepted.slice(headCut, accepted.length - tailCut).join('\n');
}

export class KugouProvider implements LyricsProvider {
  public readonly name = 'KuGou';

  public async setup(): Promise<boolean> {
    return true;
  }

  private async searchSong(query: string): Promise<KgSearchSongResponse | null> {
    const params = new URLSearchParams({
      version: '9108',
      plat: '0',
      pagesize: '8',
      showtype: '0',
      keyword: query
    });
    const r = await makeRequest<KgSearchSongResponse>(`${SEARCH_SONG}?${params}`);
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private async searchLyrics(query: string, hash?: string, duration = 0): Promise<KgSearchLyricsResponse | null> {
    const params = new URLSearchParams({
      ver: '1',
      man: 'yes',
      client: 'pc',
      ...(hash ? { hash } : { keyword: query }),
      ...(duration > 0 ? { duration: String(duration * 1000) } : {})
    });
    const r = await makeRequest<KgSearchLyricsResponse>(`${SEARCH_LYRICS}?${params}`);
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private async download(id: number, accessKey: string): Promise<string | null> {
    const params = new URLSearchParams({
      fmt: 'lrc',
      charset: 'utf8',
      client: 'pc',
      ver: '1',
      id: String(id),
      accesskey: accessKey
    });
    const r = await makeRequest<KgDownloadResponse>(`${DOWNLOAD_LRC}?${params}`);
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    if (r.body.status !== 200 || !r.body.content) return null;
    try {
      return Buffer.from(r.body.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const parts = query.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
    const artist = parts.length > 1 ? normalizeArtist(parts[0] || '') : '';
    const title = normalizeTitle(parts.length > 1 ? parts[1] || '' : parts[0] || '');
    const searchQ = `${title} - ${artist}`.trim();
    const r = await this.searchSong(searchQ);
    if (!r?.data?.info?.length) return [];
    return r.data.info.map((s) => ({
      provider: this.name,
      name: s.songname || title,
      artist: s.singername || artist,
      duration: s.duration,
      trackId: s.hash
    }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const hash = String(trackId);
    const cand = await this.searchLyrics('', hash);
    if (!cand?.candidates?.length) return null;
    const top = cand.candidates[0];
    if (!top) return null;
    const text = await this.download(top.id, top.accesskey);
    if (!text) return null;
    return {
      synced: normalizeLrc(text),
      unsynced: /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(text) ? undefined : text
    };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = query.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
    const artist = parts.length > 1 ? normalizeArtist(parts[0] || '') : '';
    const title = normalizeTitle(parts.length > 1 ? parts[1] || '' : parts[0] || '');
    const searchQ = `${title} - ${artist}`.trim();
    const songRes = await this.searchSong(searchQ);
    if (songRes?.data?.info?.length) {
      for (const song of songRes.data.info) {
        const cand = await this.searchLyrics('', song.hash, song.duration || 0);
        if (!cand?.candidates?.length) continue;
        const top = cand.candidates[0];
        if (!top) continue;
        const text = await this.download(top.id, top.accesskey);
        if (!text) continue;
        return {
          synced: normalizeLrc(text),
          unsynced: /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(text) ? undefined : text,
          name: song.songname || title,
          artist: song.singername || artist,
          duration: song.duration
        };
      }
    }
    const kw = await this.searchLyrics(searchQ);
    if (kw?.candidates?.length) {
      const top = kw.candidates[0];
      if (top) {
        const text = await this.download(top.id, top.accesskey);
        if (text) {
          return {
            synced: normalizeLrc(text),
            unsynced: /\[\d{1,2}:\d{1,2}\.\d{2,3}\]/.test(text) ? undefined : text,
            name: title,
            artist
          };
        }
      }
    }
    return null;
  }
}
