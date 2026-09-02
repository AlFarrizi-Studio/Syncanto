import type { LyricsProvider, LyricsSearchResult, LyricsTrack } from '../types';
import { log, makeRequest } from '../utils/http';
import { stripQuery } from '../utils/text';

interface LetrasSolrDoc {
  dns: string;
  url: string;
  txt: string;
  art: string;
  t?: string;
}

interface LetrasSolrResponse {
  response: { docs: LetrasSolrDoc[] };
}

interface LetrasOmqPayload {
  ID?: string;
  YoutubeID?: string;
  Name?: string;
  SongLanguage?: string;
}

interface LetrasSubtitleEntry {
  0: string;
  1: number;
  2: number;
}

const SOLR = 'https://solr.sscdn.co/letras/m1/';

function escapeSolr(input: string): string {
  return input
    .replace(/[+\-!(){}\[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class LetrasMusProvider implements LyricsProvider {
  public readonly name = 'LetrasMus';

  public async setup(): Promise<boolean> {
    return true;
  }

  public async search(query: string): Promise<LyricsSearchResult[]> {
    const safeQuery = escapeSolr(query);
    if (!safeQuery) return [];
    const url = `${SOLR}?q=${encodeURIComponent(safeQuery)}&wt=json&callback=LetrasSug`;
    const response = await makeRequest<string>(url);

    if (response.error || response.statusCode !== 200) {
      log('debug', this.name, `search failed: ${response.error || response.statusCode}`);
      return [];
    }

    const raw = String(response.body || '');
    const body = raw.trim();
    const json = body.replace(/^[^(]*?\(/, '').replace(/\);?\s*$/, '');
    let parsed: LetrasSolrResponse | null = null;
    try {
      parsed = JSON.parse(json) as LetrasSolrResponse;
    } catch {
      return [];
    }

    const docs = parsed?.response?.docs || [];
    return docs
      .filter((doc) => doc.t === '2' && doc.dns && doc.url)
      .map((doc) => ({
        provider: this.name,
        name: doc.txt,
        artist: doc.art,
        trackId: `https://www.letras.mus.br/${doc.dns}/${doc.url}/`
      }));
  }

  public async getById(trackId: string | number): Promise<LyricsTrack | null> {
    const url = String(trackId);
    const htmlResponse = await makeRequest<string>(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    });
    if (htmlResponse.error || htmlResponse.statusCode !== 200) return null;

    const html = String(htmlResponse.body || '');

    const omqMatch = html.match(/_omq\.push\(\['ui\/lyric',\s*({[\s\S]*?})\s*,/i);
    if (!omqMatch || !omqMatch[1]) return null;

    let omq: LetrasOmqPayload | null = null;
    try {
      omq = JSON.parse(omqMatch[1]) as LetrasOmqPayload;
    } catch {
      return null;
    }

    const letrasId = omq?.ID;
    const youtubeId = omq?.YoutubeID;
    if (!letrasId || !youtubeId) return null;

    const apiUrl = `https://www.letras.mus.br/api/v2/subtitle/${letrasId}/${youtubeId}/`;
    const apiResponse = await makeRequest<{ Original?: { Subtitle?: string } }>(apiUrl, {
      headers: {
        Accept: 'application/json',
        Referer: url,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    if (apiResponse.error || apiResponse.statusCode !== 200) return null;

    const sub = apiResponse.body?.Original?.Subtitle;
    if (!sub) return null;

    let parsedSub: LetrasSubtitleEntry[] = [];
    try {
      const data = JSON.parse(sub);
      parsedSub = Array.isArray(data) ? data : (data?.subtitle as LetrasSubtitleEntry[]);
    } catch {
      return null;
    }

    if (!Array.isArray(parsedSub) || !parsedSub.length) return null;

    const lines = parsedSub
      .filter((entry) => Array.isArray(entry) && entry.length >= 3)
      .map((entry) => {
        const start = Number.parseFloat(String(entry[1] || 0));
        const end = Number.parseFloat(String(entry[2] || 0));
        return {
          text: String(entry[0] || '').trim(),
          time: Math.round(start * 1000),
          duration: Math.max(0, Math.round((end - start) * 1000))
        };
      })
      .filter((line) => line.text);

    if (!lines.length) return null;
    const lrc = lines
      .map((line) => {
        const minutes = Math.floor(line.time / 60_000);
        const seconds = (line.time - minutes * 60_000) / 1000;
        return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}] ${line.text}`;
      })
      .join('\n');

    return { synced: lrc, name: omq?.Name };
  }

  public async getLyrics(query: string): Promise<LyricsTrack | null> {
    const parts = stripQuery(query);
    const searchTitle = parts.title || query;
    const results = await this.search(searchTitle);
    if (!results.length) {
      log('debug', this.name, `no match for: ${query}`);
      return null;
    }
    let best = results[0];
    if (parts.artist) {
      const artistLc = parts.artist.toLowerCase();
      const scored = [...results]
        .map((r) => ({
          r,
          s: r.artist.toLowerCase().includes(artistLc) ? 1 : 0
        }))
        .sort((a, b) => b.s - a.s);
      best = scored[0]?.r || best;
    }
    if (!best?.trackId) return null;
    const track = await this.getById(best.trackId);
    if (!track) return null;
    return { ...track, name: track.name || best.name, artist: best.artist };
  }
}
