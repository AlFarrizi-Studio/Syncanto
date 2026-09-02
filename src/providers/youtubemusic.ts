import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery } from '../utils/text';

interface YtSearchResponse {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicCardShelfRenderer?: {
                  title?: { runs?: Array<{ text: string }> };
                  subtitle?: { runs?: Array<{ text: string }> };
                  onTap?: { watchEndpoint?: { videoId?: string } };
                  buttons?: Array<{
                    buttonRenderer?: {
                      command?: {
                        watchEndpoint?: { videoId?: string };
                      };
                    };
                  }>;
                };
                musicShelfRenderer?: {
                  contents?: Array<{
                    musicResponsiveListItemRenderer?: {
                      playlistItemData?: { playlistSetVideoId?: string };
                      overlay?: {
                        musicItemThumbnailOverlayRenderer?: {
                          content?: {
                            musicPlayButtonRenderer?: {
                              playEndpoint?: {
                                watchEndpoint?: { videoId?: string };
                              };
                            };
                          };
                        };
                      };
                      flexColumns?: Array<{
                        musicResponsiveListItemFlexColumnRenderer?: {
                          text?: { runs?: Array<{ text: string }> };
                        };
                      }>;
                    };
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

interface YtNextResponse {
  contents?: {
    singleColumnMusicWatchNextResultsRenderer?: {
      tabbedRenderer?: {
        watchNextTabbedResultsRenderer?: {
          tabs?: Array<{
            tabRenderer?: {
              unselectable?: boolean;
              endpoint?: {
                browseEndpoint?: { browseId?: string };
              };
              content?: unknown;
            };
          }>;
        };
      };
    };
  };
}

interface YtBrowseLyrics {
  contents?: {
    sectionListRenderer?: {
      contents?: Array<{
        musicDescriptionShelfRenderer?: {
          description?: { runs?: Array<{ text: string }> };
          footer?: { runs?: Array<{ text: string }> };
        };
      }>;
    };
  };
}

const YT_MUSIC_BASE = 'https://music.youtube.com';
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilc_Ypq9pW6tA';
const CLIENT_NAME = 'WEB_REMIX';
const CLIENT_VERSION = '1.20240101.00.00';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  Origin: YT_MUSIC_BASE,
  Referer: `${YT_MUSIC_BASE}/`
};

function parseDurationMs(d?: string): number | undefined {
  if (!d) return undefined;
  const parts = d.split(':').map((p) => p.trim());
  if (parts.length === 2) {
    return Number(parts[0]) * 60_000 + Number(parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return Number(parts[0]) * 3_600_000 + Number(parts[1]) * 60_000 + Number(parts[2]) * 1000;
  }
  return undefined;
}

export interface YouTubeMusicProviderOptions {
  cookies?: string;
}

export class YouTubeMusicProvider implements LyricsProvider {
  public readonly name = 'YouTubeMusic';
  private cookies: string;

  public constructor(options: YouTubeMusicProviderOptions = {}) {
    this.cookies = options.cookies || process.env.YT_MUSIC_COOKIES || '';
  }

  public async setup(): Promise<boolean> {
    return true;
  }

  private async innertubePost<T>(endpoint: string, body: Record<string, unknown>): Promise<T | null> {
    const url = `${YT_MUSIC_BASE}/youtubei/v1/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
    const payload = {
      ...body,
      context: {
        client: {
          clientName: CLIENT_NAME,
          clientVersion: CLIENT_VERSION,
          hl: 'en',
          gl: 'US'
        }
      }
    };
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };
    if (this.cookies) headers['Cookie'] = this.cookies;
    const r = await makeRequest<T>(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeout: 15_000
    });
    if (r.error || r.statusCode !== 200 || !r.body) return null;
    return r.body;
  }

  private async searchVideoId(query: string): Promise<string | null> {
    const res = await this.innertubePost<YtSearchResponse>('search', {
      query,
      params: 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFRAW'
    });
    if (!res) {
      log('debug', this.name, `searchVideoId: innertube returned null for "${query}"`);
      return null;
    }

    const tabs = res.contents?.tabbedSearchResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents || [];
      for (const section of sections) {
        if (section.musicCardShelfRenderer) {
          const card = section.musicCardShelfRenderer;
          const videoId =
            card.onTap?.watchEndpoint?.videoId ||
            card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
          if (videoId) return videoId;
        }
        if (section.musicShelfRenderer) {
          for (const item of section.musicShelfRenderer.contents || []) {
            const r = item.musicResponsiveListItemRenderer;
            if (!r) continue;
            const videoId = r.playlistItemData?.playlistSetVideoId || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playEndpoint?.watchEndpoint?.videoId;
            if (videoId) return videoId;
          }
        }
      }
    }
    log('debug', this.name, `searchVideoId: no videoId found for "${query}"`);
    return null;
  }

  private async getLyricsBrowseId(videoId: string): Promise<string | null> {
    const res = await this.innertubePost<YtNextResponse>('next', {
      videoId,
      playlistId: 'RDAMVM' + videoId,
      enablePersistentPlaylistPanel: true,
      isAudioOnly: true
    });
    if (!res) {
      log('debug', this.name, `getLyricsBrowseId: innertube next returned null for ${videoId}`);
      return null;
    }
    const tabs =
      res.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ||
      [];
    for (const tab of tabs) {
      const r = tab.tabRenderer;
      if (!r) continue;
      if (r.unselectable) {
        log('debug', this.name, `getLyricsBrowseId: lyrics tab unselectable for ${videoId} (need login)`);
        continue;
      }
      const browseId = r.endpoint?.browseEndpoint?.browseId;
      if (browseId && /MPLYt/.test(browseId)) return browseId;
      if (browseId && /Lyric/.test(browseId)) return browseId;
    }
    log('debug', this.name, `getLyricsBrowseId: no MPLYt browseId for ${videoId} (login required)`);
    return null;
  }

  private async fetchLyrics(browseId: string): Promise<string | null> {
    const res = await this.innertubePost<YtBrowseLyrics>('browse', { browseId });
    if (!res) return null;
    const desc =
      res.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description?.runs
        ?.map((r) => r.text)
        .join('') || '';
    if (!desc) return null;
    return desc;
  }

  private async fetchMetadata(videoId: string): Promise<{ title: string; artist: string; duration?: number } | null> {
    const res = await this.innertubePost<YtNextResponse>('next', {
      videoId,
      playlistId: 'RDAMVM' + videoId,
      isAudioOnly: true
    });
    if (!res) return null;
    const tabs =
      res.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ||
      [];
    let title = '';
    let artist = '';
    let duration: number | undefined;
    for (const tab of tabs) {
      const r = tab.tabRenderer;
      const contents = (r?.content as { musicQueueRenderer?: unknown })?.musicQueueRenderer as unknown;
      if (contents && typeof contents === 'object') {
        const json = JSON.stringify(contents);
        const titleMatch = json.match(/"title":\s*\{[^}]*"runs":\s*\[\{\s*"text":\s*"([^"]+)"/);
        const artistMatch = json.match(/"longBylineText":\s*\{[^}]*"runs":\s*\[\{\s*"text":\s*"([^"]+)"/);
        const durationMatch = json.match(/"lengthText":\s*\{[^}]*"runs":\s*\[\{\s*"text":\s*"([^"]+)"/);
        if (titleMatch) title = titleMatch[1] || title;
        if (artistMatch) artist = artistMatch[1] || artist;
        if (durationMatch) duration = parseDurationMs(durationMatch[1]) || duration;
      }
    }
    return title || artist ? { title, artist, duration } : null;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const videoId = await this.searchVideoId(query);
    if (!videoId) return [];
    return [
      {
        provider: this.name,
        name: query,
        artist: '',
        trackId: videoId
      }
    ];
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const videoId = String(trackId);
    if (!videoId) return null;
    const browseId = await this.getLyricsBrowseId(videoId);
    if (!browseId) {
      log('debug', this.name, `no lyrics tab for video ${videoId} (login/PoToken required)`);
      return null;
    }
    const lyrics = await this.fetchLyrics(browseId);
    if (!lyrics) return null;
    return { unsynced: lyrics };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const searchQuery = parts.artist ? `${parts.artist} ${parts.title}` : parts.title || query;
    const videoId = await this.searchVideoId(searchQuery);
    if (!videoId) return null;
    const browseId = await this.getLyricsBrowseId(videoId);
    if (!browseId) {
      log('debug', this.name, `no lyrics tab for "${query}"`);
      return null;
    }
    const [lyrics, meta] = await Promise.all([this.fetchLyrics(browseId), this.fetchMetadata(videoId)]);
    if (!lyrics) return null;
    return {
      unsynced: lyrics,
      name: meta?.title,
      artist: meta?.artist,
      duration: meta?.duration
    };
  }
}