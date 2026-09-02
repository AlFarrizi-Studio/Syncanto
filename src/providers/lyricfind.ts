import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { bestMatch, stripQuery } from '../utils/text';
import {
  type ProxyEndpoint,
  detectCountry,
  loadProxies,
  markProxyFailure,
  markProxySuccess,
  pickProxy,
  proxiedRequest
} from '../utils/proxy';

interface LfSearchTrack {
  lfid: string;
  title: string;
  artist: { name: string } | string;
  artists?: Array<{ name: string }>;
  album?: { title?: string; releaseYear?: number };
  language?: string;
  isrcs?: string[];
  instrumental?: boolean;
  viewable?: boolean;
  has_lrc?: boolean;
  lrc_verified?: boolean;
  snippet?: string;
  context?: string;
  lyricfind_url?: string;
  slug: string;
  score?: number;
  available_translations?: string[];
  duration?: string;
  spotify?: string;
  apple?: number;
  deezer?: number;
  last_update?: string;
}

interface LfSearchResponse {
  tracks?: LfSearchTrack[];
  response?: { code?: number; message?: string };
}

interface LfOfficialLyricResponse {
  response?: {
    code?: number;
    message?: string;
    lyrics?: { lyrics_body?: string; lyrics_copyright?: string };
  };
}

interface LfOfficialTrackItem {
  track_id: number;
  track_name: string;
  artist_name: string;
  album_name?: string;
  duration?: number;
}

interface LfOfficialSearchResponse {
  response?: { tracks?: LfOfficialTrackItem[]; code?: number; message?: string };
}

const LF_DOMAIN = 'https://lyrics.lyricfind.com/';
const LF_OFFICIAL = 'https://api.lyricfind.com';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface LyricFindProviderOptions {
  territory?: string;
  limit?: number;
  proxies?: ProxyEndpoint[];
  autoTerritory?: boolean;
  apiKey?: string;
}

interface PickedTrack {
  slug: string;
  lfid: string;
  title: string;
  artist: string;
  album: string;
  duration?: string;
  snippet?: string;
  language?: string;
  has_lrc?: boolean;
  lrc_verified?: boolean;
  spotify?: string;
  apple?: number;
  deezer?: number;
}

export class LyricFindProvider implements LyricsProvider {
  public readonly name = 'LyricFind';
  private territory: string | null;
  private limit: number;
  private proxies: ProxyEndpoint[];
  private autoTerritory: boolean;
  private apiKey: string;
  private officialToken: string | null = null;
  private officialTokenExpiry = 0;

  public constructor(options: LyricFindProviderOptions = {}) {
    this.territory = options.territory || process.env.LYRICFIND_TERRITORY || null;
    this.limit = options.limit || Number(process.env.LYRICFIND_LIMIT || 5);
    this.proxies = options.proxies || loadProxies();
    this.autoTerritory = options.autoTerritory ?? !this.territory;
    this.apiKey = options.apiKey || process.env.LYRICFIND_API_KEY || '';
  }

  private nextProxy(): ProxyEndpoint | null {
    return pickProxy(this.proxies);
  }

  private async resolveTerritory(): Promise<string> {
    if (this.territory) return this.territory;
    if (this.autoTerritory) {
      try {
        const { country } = await detectCountry();
        this.territory = country.toLowerCase();
        return this.territory;
      } catch {
        this.territory = 'us';
      }
    }
    return 'us';
  }

  private async fetchOfficialToken(): Promise<boolean> {
    if (!this.apiKey) return false;
    const now = Date.now();
    if (this.officialToken && now < this.officialTokenExpiry) return true;
    const r = await makeRequest<{ access_token: string; expires_in: number }>(
      `${LF_OFFICIAL}/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&apikey=${encodeURIComponent(this.apiKey)}`
      }
    );
    if (r.error || r.statusCode !== 200 || !r.body?.access_token) return false;
    this.officialToken = r.body.access_token;
    this.officialTokenExpiry = now + (r.body.expires_in - 60) * 1000;
    return true;
  }

  public async setup(): Promise<boolean> {
    await this.resolveTerritory();
    if (this.apiKey) await this.fetchOfficialToken();
    return Boolean(this.territory);
  }

  private async publicSearchTracks(query: string): Promise<LfSearchTrack[]> {
    const territory = await this.resolveTerritory();
    const proxy = this.nextProxy();
    const params = new URLSearchParams({
      reqtype: 'default',
      territory,
      output: 'json',
      useragent: DEFAULT_UA,
      searchtype: 'track',
      limit: String(this.limit),
      all: query,
      alltracks: 'no'
    });
    const url = `${LF_DOMAIN}api/v1/search?${params}`;
    const r = proxy
      ? await proxiedRequest<LfSearchResponse>(url, { proxy })
      : await makeRequest<LfSearchResponse>(url);
    if (proxy) {
      if (r.error || r.statusCode >= 400) markProxyFailure(proxy);
      else markProxySuccess(proxy);
    }
    if (r.error || r.statusCode !== 200) return [];
    return r.body?.tracks || [];
  }

  private async officialSearchTracks(query: string): Promise<LfOfficialTrackItem[]> {
    if (!this.officialToken && !(await this.fetchOfficialToken())) return [];
    const params = new URLSearchParams({
      reqtype: 'search',
      searchtype: 'track',
      texttype: 'plain',
      artist: '',
      title: query,
      keyword: query
    });
    const r = await makeRequest<LfOfficialSearchResponse>(
      `${LF_OFFICIAL}/search.do?${params}`,
      { headers: { Authorization: `Bearer ${this.officialToken}` } }
    );
    if (r.error || r.statusCode !== 200) return [];
    return r.body?.response?.tracks || [];
  }

  private async officialGetLyricsById(trackId: number): Promise<string | null> {
    if (!this.officialToken && !(await this.fetchOfficialToken())) return null;
    const params = new URLSearchParams({
      reqtype: 'lyric',
      texttype: 'plain',
      trackid: String(trackId),
      output: 'json'
    });
    const r = await makeRequest<LfOfficialLyricResponse>(`${LF_OFFICIAL}/lyric.do?${params}`, {
      headers: { Authorization: `Bearer ${this.officialToken}` }
    });
    if (r.error || r.statusCode !== 200) return null;
    return r.body?.response?.lyrics?.lyrics_body || null;
  }

  private pickArtist(track: LfSearchTrack): string {
    if (typeof track.artist === 'string') return track.artist;
    if (track.artist?.name) return track.artist.name;
    if (track.artists?.length) return track.artists.map((a) => a.name).filter(Boolean).join(', ');
    return '';
  }

  private toPicked(track: LfSearchTrack): PickedTrack {
    return {
      slug: track.slug,
      lfid: track.lfid,
      title: track.title,
      artist: this.pickArtist(track),
      album: track.album?.title || '',
      duration: track.duration,
      snippet: track.snippet,
      language: track.language,
      has_lrc: track.has_lrc,
      lrc_verified: track.lrc_verified,
      spotify: track.spotify,
      apple: track.apple,
      deezer: track.deezer
    };
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const tracks = await this.publicSearchTracks(query);
    return tracks.map((t) => ({
      provider: this.name,
      name: t.title,
      artist: this.pickArtist(t),
      album: t.album?.title,
      trackId: t.slug || t.lfid
    }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const slug = String(trackId);
    const tracks = await this.publicSearchTracks(slug);
    const t = tracks[0];
    if (!t) return null;
    return this.buildTrackFromPicked(this.toPicked(t));
  }

  private async buildTrackFromPicked(picked: PickedTrack): Promise<LyricsTrack | null> {
    if (this.apiKey) {
      const officialTracks = await this.officialSearchTracks(`${picked.title} ${picked.artist}`);
      const match = bestMatch(
        officialTracks,
        `${picked.title} ${picked.artist}`,
        (t) => `${t.track_name} ${t.artist_name}`.toLowerCase(),
        40
      );
      if (match) {
        const full = await this.officialGetLyricsById(match.track_id);
        if (full) {
          return {
            unsynced: full,
            name: match.track_name,
            artist: match.artist_name,
            album: match.album_name,
            duration: match.duration
          };
        }
      }
    }
    if (!picked.snippet) return null;
    const cleaned = picked.snippet.replace(/<em>(.*?)<\/em>/g, '$1').replace(/<[^>]+>/g, '').trim();
    if (!cleaned) return null;
    return {
      unsynced: cleaned,
      name: picked.title,
      artist: picked.artist,
      album: picked.album
    };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const artist = parts.artist || '';
    const title = parts.title || query;
    const tracks = await this.publicSearchTracks(query);
    if (!tracks.length) {
      log('debug', this.name, `no match for: ${query}`);
      return null;
    }
    const target = `${title} ${artist}`.toLowerCase();
    const best = bestMatch(
      tracks,
      target,
      (t) => `${t.title} ${this.pickArtist(t)}`.toLowerCase(),
      40
    );
    if (!best) return null;
    const picked = this.toPicked(best);
    const result = await this.buildTrackFromPicked(picked);
    if (result && this.apiKey) {
      log('info', this.name, `used official API key for "${picked.title}"`);
    } else if (result) {
      log('debug', this.name, `returning snippet preview for "${picked.title}" (no LYRICFIND_API_KEY)`);
    }
    return result;
  }
}