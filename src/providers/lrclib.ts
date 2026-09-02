import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery, cleanTitle, bestMatch } from '../utils/text';

interface LrclibSearchItem {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

interface LrclibGetResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export class LrclibProvider implements LyricsProvider {
  public readonly name = 'LRCLIB';
  private root = 'https://lrclib.net';
  private searchEndpoint = `${this.root}/api/search`;
  private getEndpoint = `${this.root}/api/get`;

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const { artist, title } = stripQuery(cleanTitle(query));
    const searchTitle = cleanTitle(title);
    const searchArtist = artist ? cleanTitle(artist) : '';

    const searchQuery = searchArtist
      ? `${searchTitle} ${searchArtist}`
      : searchTitle;

    const url = `${this.searchEndpoint}?q=${encodeURIComponent(searchQuery)}`;
    const response = await makeRequest<LrclibSearchItem[]>(url);

    if (response.error || response.statusCode !== 200 || !Array.isArray(response.body)) {
      log('debug', this.name, `search failed: ${response.error || response.statusCode}`);
      return [];
    }

    return response.body
      .filter((item) => !item.instrumental)
      .map((item) => ({
        provider: this.name,
        name: item.trackName,
        artist: item.artistName,
        album: item.albumName,
        duration: item.duration,
        syncedLyrics: item.syncedLyrics || undefined,
        plainLyrics: item.plainLyrics || undefined,
        trackId: item.id
      }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const url = `${this.getEndpoint}/${trackId}`;
    const response = await makeRequest<LrclibGetResponse>(url);
    if (response.error || response.statusCode !== 200 || !response.body) return null;

    const data = response.body;
    return {
      name: data.trackName,
      artist: data.artistName,
      album: data.albumName,
      duration: data.duration,
      synced: data.syncedLyrics,
      unsynced: data.plainLyrics
    };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const results = await this.search(query);
    if (!results.length) return null;

    const { artist, title } = stripQuery(cleanTitle(query));
    const cmpKey = (r: LyricsSearchResult) => `${r.artist} - ${r.name}`;
    const target = `${artist || ''} - ${title}`.trim();

    const sorted = [...results].sort(
      (a, b) => bestMatchRank(b, target, cmpKey) - bestMatchRank(a, target, cmpKey)
    );

    const top = sorted[0];
    if (!top) return null;

    if (top.syncedLyrics || top.plainLyrics) {
      return {
        name: top.name,
        artist: top.artist,
        album: top.album,
        duration: top.duration,
        synced: top.syncedLyrics,
        unsynced: top.plainLyrics
      };
    }

    if (top.trackId !== undefined) {
      return this.getById(top.trackId);
    }
    return null;
  }
}

function bestMatchRank(item: LyricsSearchResult, target: string, key: (i: LyricsSearchResult) => string): number {
  if (!target) return 0;
  const candidate = key(item).toLowerCase();
  const lowerTarget = target.toLowerCase();
  if (candidate === lowerTarget) return 200;
  if (candidate.includes(lowerTarget) || lowerTarget.includes(candidate)) return 100;
  return bestMatch([item], target, key) ? 50 : 0;
}
