import type { LyricsProvider, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { MusixmatchProvider } from './musixmatch';

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
}

interface SpotifyLyricsResponse {
  lyrics: {
    syncType: 'LINE_SYNCED' | 'UNSYNCED';
    lines: Array<{
      startTimeMs: string;
      words: string;
    }>;
  };
}

export class SpotifyProvider implements LyricsProvider {
  public readonly name = 'Spotify';
  private musixmatch: MusixmatchProvider;
  private accessToken: string | null = null;
  private tokenExpires = 0;
  private clientId: string;
  private clientSecret: string;

  public constructor(
    musixmatch: MusixmatchProvider,
    clientId?: string,
    clientSecret?: string
  ) {
    this.musixmatch = musixmatch;
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
  }

  public async setup(): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) {
      log('warn', this.name, 'client_id/client_secret not set; using musixmatch fallback');
    } else {
      await this.ensureToken();
    }
    return true;
  }

  private async ensureToken(): Promise<string | null> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpires) return this.accessToken;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await makeRequest<SpotifyTokenResponse>(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      }
    );

    if (response.error || response.statusCode !== 200) {
      log('warn', this.name, `token failed: ${response.error || response.statusCode}`);
      return null;
    }

    this.accessToken = response.body.access_token;
    this.tokenExpires = now + response.body.expires_in * 1000;
    return this.accessToken;
  }

  public async search(_query: string): Promise<never[]> {
    log('debug', this.name, 'search not supported; use getLyrics with title - artist');
    return [];
  }

  public async getById(_trackId: string | number): Promise<LyricsTrack | null> {
    return null;
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const token = await this.ensureToken();
    if (!token) {
      return this.musixmatch.getLyrics(query);
    }

    const [trackName, artistName] = query.split(/\s+-\s+/);
    if (!trackName) return this.musixmatch.getLyrics(query);

    const search = await makeRequest<{ tracks: { items: Array<{ id: string; name: string; artists: Array<{ name: string }>; duration_ms: number; album?: { name: string } }> } }>(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (search.error || search.statusCode !== 200) {
      return this.musixmatch.getLyrics(query);
    }

    const tracks = search.body?.tracks?.items || [];
    if (!tracks.length) return this.musixmatch.getLyrics(query);

    const track = tracks[0];
    if (!track) return this.musixmatch.getLyrics(query);

    const lyricsResponse = await makeRequest<SpotifyLyricsResponse>(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${track.id}?format=json&vocalRemoval=false`,
      { headers: { Authorization: `Bearer ${token}`, 'App-Platform': 'WebPlayer' } }
    );

    if (lyricsResponse.error || lyricsResponse.statusCode !== 200) {
      return this.musixmatch.getLyrics(query);
    }

    const data = lyricsResponse.body;
    if (!data?.lyrics?.lines?.length) return this.musixmatch.getLyrics(query);

    if (data.lyrics.syncType === 'LINE_SYNCED') {
      const lrc = data.lyrics.lines
        .filter((l) => l.words?.trim())
        .map((l) => {
          const ms = Number.parseInt(l.startTimeMs || '0', 10);
          const minutes = Math.floor(ms / 60_000);
          const seconds = (ms - minutes * 60_000) / 1000;
          return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${l.words}`;
        })
        .join('\n');
      return {
        synced: lrc,
        name: track.name,
        artist: track.artists[0]?.name || artistName,
        album: track.album?.name,
        duration: track.duration_ms
      };
    }

    const plain = data.lyrics.lines.map((l) => l.words).join('\n');
    return {
      unsynced: plain,
      name: track.name,
      artist: track.artists[0]?.name || artistName,
      album: track.album?.name,
      duration: track.duration_ms
    };
  }
}
