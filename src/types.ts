export interface LyricsLine {
  text: string;
  time: number;
  duration: number;
}

export interface LyricsTrack {
  synced?: string | null;
  unsynced?: string | null;
  name?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

export interface LyricsSearchResult {
  provider: string;
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
  trackId?: string | number;
}

export interface LyricsProvider {
  readonly name: string;
  setup(): Promise<boolean>;
  search(query: string): Promise<LyricsSearchResult[]>;
  getById(trackId: string | number): Promise<LyricsTrack | null>;
  getLyrics(query: string): Promise<LyricsTrack | null>;
}

export interface ProxyRef {
  url: string;
  protocol?: 'http' | 'https';
  failures?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeout?: number;
  signal?: AbortSignal;
  family?: 4 | 6;
  proxy?: ProxyRef;
}

export interface RequestResponse<T = unknown> {
  statusCode: number;
  body: T;
  headers: Record<string, string>;
  error?: string;
  raw?: string;
  setCookie?: string[];
}
