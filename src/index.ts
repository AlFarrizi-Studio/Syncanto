import type { LyricsLine, LyricsProvider, LyricsTrack } from './types';
import { log } from './utils/http';
import { isSyncedLrc, parseLrc } from './utils/text';
import { type ProxyEndpoint, loadProxies } from './utils/proxy';

import { AppleMusicProvider } from './providers/applemusic';
import { BetterLyricsProvider } from './providers/betterlyrics';
import { BiniLyricsProvider } from './providers/binilyrics';
import { GeniusProvider } from './providers/genius';
import { KugouProvider } from './providers/kugou';
import { LetrasMusProvider } from './providers/letrasmus';
import { LrclibProvider } from './providers/lrclib';
import { LyricFindProvider, type LyricFindProviderOptions } from './providers/lyricfind';
import { LyricsOvhProvider } from './providers/lyricsovh';
import { MusixmatchProvider } from './providers/musixmatch';
import { NetEaseProvider } from './providers/netease';
import { QQMusicProvider } from './providers/qqmusic';
import { SpotifyProvider } from './providers/spotify';
import { UnisonProvider } from './providers/unison';
import { YouLyPlusProvider } from './providers/youlyplus';
import { YouTubeCaptionsProvider, type YouTubeCaptionsProviderOptions } from './providers/youtubecaptions';
import { YouTubeMusicProvider, type YouTubeMusicProviderOptions } from './providers/youtubemusic';

export interface LyricsManagerOptions {
  providers?: string[];
  spotify?: { clientId?: string; clientSecret?: string };
  lyricfind?: Omit<LyricFindProviderOptions, 'proxies'>;
  youtubeMusic?: YouTubeMusicProviderOptions;
  youtubeCaptions?: YouTubeCaptionsProviderOptions;
  proxies?: ProxyEndpoint[];
  preferSynced?: boolean;
}

export interface LyricsResult {
  lines: LyricsLine[];
  name?: string;
  artist?: string;
  album?: string;
  duration?: number;
  provider: string;
  synced: boolean;
}

export class LyricsManager {
  public readonly providers: Map<string, LyricsProvider> = new Map();
  private order: string[] = [];
  private preferSynced: boolean;
  private musixmatch: MusixmatchProvider;

  public constructor(options: LyricsManagerOptions = {}) {
    this.preferSynced = options.preferSynced ?? true;

    const proxies = options.proxies || loadProxies();

    this.musixmatch = new MusixmatchProvider();
    const spotify = new SpotifyProvider(
      this.musixmatch,
      options.spotify?.clientId,
      options.spotify?.clientSecret
    );
    const lyricfind = new LyricFindProvider({ ...options.lyricfind, proxies });
    const youtubeMusic = new YouTubeMusicProvider(options.youtubeMusic);
    const youtubeCaptions = new YouTubeCaptionsProvider(options.youtubeCaptions);

    const all: LyricsProvider[] = [
      this.musixmatch,
      new LrclibProvider(),
      new NetEaseProvider(),
      new LetrasMusProvider(),
      spotify,
      new KugouProvider(),
      new QQMusicProvider(),
      new AppleMusicProvider(),
      new YouLyPlusProvider(),
      new BiniLyricsProvider(),
      new BetterLyricsProvider(),
      new LyricsOvhProvider(),
      new UnisonProvider(),
      new GeniusProvider(),
      lyricfind,
      youtubeMusic,
      youtubeCaptions
    ];

    for (const p of all) this.providers.set(p.name, p);

    const requested = options.providers || all.map((p) => p.name);
    this.order = requested.filter((n) => this.providers.has(n));
  }

  public list(): string[] {
    return [...this.order];
  }

  public async initialize(): Promise<void> {
    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        try {
          await p.setup();
        } catch (err) {
          log('warn', 'LyricsManager', `${p.name} setup failed: ${(err as Error).message}`);
        }
      })
    );
  }

  public async getLyrics(query: string): Promise<LyricsResult | null> {
    for (const name of this.order) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      try {
        const track = await provider.getLyrics(query);
        if (!track) continue;
        const result = this.buildResult(track, provider.name);
        if (result) return result;
      } catch (err) {
        log('warn', 'LyricsManager', `${name} failed: ${(err as Error).message}`);
      }
    }
    return null;
  }

  public async getFromProvider(name: string, query: string): Promise<LyricsResult | null> {
    const provider = this.providers.get(name);
    if (!provider) return null;
    const track = await provider.getLyrics(query);
    if (!track) return null;
    return this.buildResult(track, provider.name);
  }

  private buildResult(track: LyricsTrack, provider: string): LyricsResult | null {
    const syncedRaw = track.synced;
    const unsyncedRaw = track.unsynced;

    let chosen: string | null = null;
    let synced = false;

    if (syncedRaw && isSyncedLrc(syncedRaw)) {
      chosen = syncedRaw;
      synced = true;
    } else if (unsyncedRaw) {
      chosen = unsyncedRaw;
      synced = false;
    } else if (syncedRaw) {
      chosen = syncedRaw;
      synced = isSyncedLrc(syncedRaw);
    }

    if (!chosen) return null;
    if (this.preferSynced && !synced) {
      const swap = unsyncedRaw && isSyncedLrc(unsyncedRaw) ? unsyncedRaw : null;
      if (swap) {
        chosen = swap;
        synced = true;
      }
    }

    const finalChosen: string = chosen;
    const lines = synced ? parseLrc(finalChosen) : this.parsePlain(finalChosen);
    if (!lines.length) return null;

    return {
      lines,
      name: track.name,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      provider,
      synced
    };
  }

  private parsePlain(text: string): LyricsLine[] {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => ({ text: l, time: 0, duration: 0 }));
  }
}

export {
  LrclibProvider,
  MusixmatchProvider,
  NetEaseProvider,
  SpotifyProvider,
  LetrasMusProvider,
  KugouProvider,
  QQMusicProvider,
  AppleMusicProvider,
  YouLyPlusProvider,
  BiniLyricsProvider,
  BetterLyricsProvider,
  LyricsOvhProvider,
  UnisonProvider,
  GeniusProvider,
  LyricFindProvider,
  YouTubeMusicProvider,
  YouTubeCaptionsProvider
};

export type * from './types';
export type { ProxyEndpoint } from './utils/proxy';
