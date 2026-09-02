import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery } from '../utils/text';

interface YtPlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl: string;
        languageCode: string;
        name?: string;
        vssId?: string;
        kind?: string;
      }>;
      audioTrack?: { captionTrackIndices?: number[] };
      translationLanguages?: Array<{ languageCode: string; languageName?: string }>;
    };
  };
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
}

interface YtPlayerSearchResponse {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicCardShelfRenderer?: {
                  onTap?: { watchEndpoint?: { videoId?: string } };
                  buttons?: Array<{
                    buttonRenderer?: {
                      command?: { watchEndpoint?: { videoId?: string } };
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
                              playEndpoint?: { watchEndpoint?: { videoId?: string } };
                            };
                          };
                        };
                      };
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

interface YtCaptionEvent {
  tStartMs: number;
  dDurationMs: number;
  segs?: Array<{ utf8?: string }>;
}

interface YtCaptionJson3 {
  events: YtCaptionEvent[];
}

const YT_MUSIC_BASE = 'https://music.youtube.com';
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilc_Ypq9pW6tA';
const CLIENT_NAME = 'WEB_REMIX';
const CLIENT_VERSION = '1.20240101.00.00';

const MUSIC_NOTES = ['\u266a', '\u266b', '\u266c', '\u2669', '\u266a', '\u266d', '\u266e', '\u266f'];

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  Origin: YT_MUSIC_BASE,
  Referer: `${YT_MUSIC_BASE}/`
};

function stripMusicNotes(s: string): string {
  let out = s;
  for (const c of MUSIC_NOTES) {
    if (out.startsWith(c)) out = out.slice(1);
    if (out.endsWith(c)) out = out.slice(0, -1);
  }
  return out.trim();
}

export interface YouTubeCaptionsProviderOptions {
  cookies?: string;
  preferManualCaptions?: boolean;
}

export class YouTubeCaptionsProvider implements LyricsProvider {
  public readonly name = 'YouTubeCaptions';
  private cookies: string;
  private preferManual: boolean;

  public constructor(options: YouTubeCaptionsProviderOptions = {}) {
    this.cookies = options.cookies || process.env.YT_MUSIC_COOKIES || '';
    this.preferManual = options.preferManualCaptions ?? true;
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
    const res = await this.innertubePost<YtPlayerSearchResponse>('search', {
      query,
      params: 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFRAW'
    });
    if (!res) return null;
    const tabs = res.contents?.tabbedSearchResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents || [];
      for (const section of sections) {
        if (section.musicCardShelfRenderer) {
          const id =
            section.musicCardShelfRenderer.onTap?.watchEndpoint?.videoId ||
            section.musicCardShelfRenderer.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
          if (id) return id;
        }
        if (section.musicShelfRenderer) {
          for (const item of section.musicShelfRenderer.contents || []) {
            const r = item.musicResponsiveListItemRenderer;
            const id =
              r?.playlistItemData?.playlistSetVideoId ||
              r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playEndpoint?.watchEndpoint?.videoId;
            if (id) return id;
          }
        }
      }
    }
    return null;
  }

  private async getPlayer(videoId: string): Promise<YtPlayerResponse | null> {
    return this.innertubePost<YtPlayerResponse>('player', {
      video_id: videoId,
      videoId,
      playlistId: 'RDAMVM' + videoId,
      isAudioOnly: true,
      contentCheckOk: true,
      racyCheckOk: true
    });
  }

  private pickTrack(tracks: NonNullable<YtPlayerResponse['captions']>['playerCaptionsTracklistRenderer'] extends infer R
    ? R extends { captionTracks?: infer T }
      ? T
      : never
    : never): typeof tracks extends Array<infer Item> ? Item : never {
    return tracks[0] as never;
  }

  private pickCaptionTrack(
    tracks: Array<{ baseUrl: string; languageCode: string; vssId?: string; kind?: string; name?: string }>
  ): { baseUrl: string; languageCode: string } | null {
    if (!tracks.length) return null;
    const manual = tracks.find((t) => !t.vssId?.startsWith('a.'));
    const auto = tracks.find((t) => t.vssId?.startsWith('a.'));
    if (this.preferManual && manual) return manual;
    if (auto) return auto;
    return this.pickTrack(tracks);
  }

  private async fetchCaptions(baseUrl: string): Promise<YtCaptionJson3 | null> {
    const url = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    const r = await makeRequest<YtCaptionJson3>(url, {
      headers: { Accept: 'application/json,text/plain;q=0.9' }
    });
    if (r.error || r.statusCode !== 200) return null;
    if (typeof r.body === 'object' && (r.body as YtCaptionJson3).events) return r.body as YtCaptionJson3;
    try {
      return JSON.parse(String(r.raw || '')) as YtCaptionJson3;
    } catch {
      return null;
    }
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
    const player = await this.getPlayer(videoId);
    if (!player) {
      log('debug', this.name, `getById: innertube player returned null for ${videoId}`);
      return null;
    }
    if (player.playabilityStatus?.status === 'LOGIN_REQUIRED') {
      log('debug', this.name, `LOGIN_REQUIRED for ${videoId} (need YT_MUSIC_COOKIES)`);
      return null;
    }
    if (player.playabilityStatus?.status === 'UNPLAYABLE') {
      log('debug', this.name, `UNPLAYABLE for ${videoId}: ${player.playabilityStatus?.reason}`);
      return null;
    }
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || !tracks.length) {
      log('debug', this.name, `no caption tracks for ${videoId} (need login)`);
      return null;
    }
    const track = this.pickCaptionTrack(tracks);
    if (!track) return null;
    const captions = await this.fetchCaptions(track.baseUrl);
    if (!captions?.events?.length) {
      log('debug', this.name, `caption fetch empty for ${videoId}`);
      return null;
    }
    const lines: Array<{ text: string; time: number; duration: number }> = [];
    for (const event of captions.events) {
      let words = '';
      if (event.segs) {
        for (const seg of event.segs) {
          words += seg.utf8 || '';
        }
      }
      words = words.replace(/\n/g, ' ');
      words = stripMusicNotes(words);
      if (!words) continue;
      lines.push({
        text: words,
        time: event.tStartMs,
        duration: event.dDurationMs || 0
      });
    }
    if (!lines.length) return null;
    const lrc = lines
      .map((l) => {
        const minutes = Math.floor(l.time / 60_000);
        const seconds = (l.time - minutes * 60_000) / 1000;
        return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${l.text}`;
      })
      .join('\n');
    return {
      synced: lrc,
      name: player.videoDetails?.title,
      artist: player.videoDetails?.author,
      duration: player.videoDetails?.lengthSeconds ? Number(player.videoDetails.lengthSeconds) * 1000 : undefined
    };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const searchQuery = parts.artist ? `${parts.artist} ${parts.title}` : parts.title || query;
    const videoId = await this.searchVideoId(searchQuery);
    if (!videoId) return null;
    return this.getById(videoId);
  }
}