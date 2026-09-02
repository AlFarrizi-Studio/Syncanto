<div align="center">

<img src="https://raw.githubusercontent.com/AlFarrizi-Studio/Syncanto/refs/heads/main/public/Syncanto.png" alt="Syncanto Logo" width="180"/>

# Syncanto Lyrics Provider

**A unified TypeScript lyrics scraper aggregating 17 sources behind a single API — with proxy rotation, IP geolocation, and graceful fallback.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-F1C40F.svg?style=for-the-badge)](LICENSE)
[![Providers](https://img.shields.io/badge/Providers-17-9B59B6.svg?style=for-the-badge)](#providers)
[![Deps](https://img.shields.io/badge/Runtime_Deps-0-27AE60.svg?style=for-the-badge)](#features)

</div>

---

## About

Syncanto is a multi-provider lyrics scraper written in TypeScript. It aggregates **17 lyrics sources** behind a single unified API, with built-in proxy rotation, IP geolocation, and graceful fallback for rate-limited or cookie-gated providers.

> Inspired by [syncedlyrics](https://github.com/moehmeni/syncedlyrics), [NodeLink](https://github.com/PerformanC/NodeLink), [better-lyrics](https://github.com/better-lyrics/better-lyrics), [YouLyPlus](https://github.com/ibratabian17/YouLyPlus), [vivi-music](https://github.com/vivizzz007/vivi-music), [ZonyLrcToolsX](https://github.com/real-zony/ZonyLrcToolsX), and [Paxsenix Lyrically](https://lyrics.paxsenix.org).

## Features

- 17 lyrics providers behind a single `LyricsManager` API
- Synced (LRC / TTML / word-by-word) and plain lyrics support
- Automatic fallback chain — first non-empty result wins
- HTTP CONNECT proxy rotation (no extra dependencies, raw `net.Socket` tunnel)
- IP geolocation via `api.iplocation.net` with 1-hour cache
- Auto-backoff for rate-limited endpoints (Genius Cloudflare 403)
- IPv4-only requests by default
- Zero runtime dependencies — only `typescript` at build time

## Installation

```bash
npm install
npm run build
```

## Quick Start

```ts
import { LyricsManager } from 'syncanto-lyrics';

const manager = new LyricsManager({
  providers: [
    'LRCLIB', 'Musixmatch', 'AppleMusic', 'YouLyPlus',
    'BiniLyrics', 'BetterLyrics', 'KuGou', 'QQMusic',
    'NetEase', 'LetrasMus', 'Genius', 'Unison', 'LyricsOvh',
    'LyricFind', 'Spotify', 'YouTubeMusic', 'YouTubeCaptions'
  ],
  preferSynced: true
});

await manager.initialize();

const lyrics = await manager.getLyrics('Adele - Hello');
if (lyrics) {
  console.log(`Got ${lyrics.lines.length} lines from ${lyrics.provider}`);
  console.log(`Synced: ${lyrics.synced}`);
}
```

## CLI

```bash
# Search a single query and print the first match with preview
npx tsx src/example.ts "Adele Hello"

# Test every provider individually with timing info
npm test -- "Eminem Lose Yourself"
```

## Providers

| # | Provider | Source | API Key | Synced | Word | Plain |
| - | -------- | ------ | ------- | :----: | :--: | :---: |
| 1 | **Musixmatch** | `apic-desktop.musixmatch.com/ws/1.1/{token,track.search,track.subtitle.get,track.lyrics.get}` + HMAC-SHA256 | – | ✓ | ✓ | ✓ |
| 2 | **LRCLIB** | `lrclib.net/api/search`, `lrclib.net/api/get/{id}` | – | ✓ | – | ✓ |
| 3 | **NetEase** | `music.163.com/api/search/pc`, `music.163.com/api/song/lyric` | – | ✓ | – | ✓ |
| 4 | **LetrasMus** | `solr.sscdn.co/letras/m1/` + `letras.mus.br/api/v2/subtitle/{id}/{yt}/` | – | ✓ | – | ✓ |
| 5 | **Spotify** | `accounts.spotify.com/api/token` + `spclient.wg.spotify.com/color-lyrics/v2/track/{id}` | optional | ✓ | – | ✓ |
| 6 | **KuGou** | `mobileservice.kugou.com/api/v3/search/song` + `lyrics.kugou.com/{search,download}` (base64) | – | ✓ | – | ✓ |
| 7 | **QQMusic** | `c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg` + `lyric/fcgi-bin/fcg_query_lyric_new.fcg` (base64) | – | ✓ | – | ✓ |
| 8 | **AppleMusic** | `itunes.apple.com/search` + `lyrics.paxsenix.org/apple-music/lyrics?id=` (TTML/LRC) | – | ✓ | ✓ | ✓ |
| 9 | **YouLyPlus** | 6 mirrors: `lyricsplus.{prjktla.my.id,atomix.one,prjktla.workers.dev}` + `seven.vercel.app` + `lyrics-plus-backend.vercel.app` + `binimum.org` (KPoe format) | – | ✓ | ✓ | ✓ |
| 10 | **BiniLyrics** | `lyrics-api.binimum.org/getLyrics?q=` + `lyrics-storage.binimum.org/{isrc}.ttml` (TTML) | – | ✓ | ✓ | ✓ |
| 11 | **BetterLyrics** | aggregator: AppleMusic + Paxsenix + LyricsPlus + BiniLyrics | – | ✓ | ✓ | ✓ |
| 12 | **LyricsOvh** | `api.lyrics.ovh/v1/{artist}/{title}` | – | – | – | ✓ |
| 13 | **Unison** | `unison.boidu.dev/lyrics/{search,id}` (TTML/LRC/plain + `x-key-id` header) | – | ✓ | ✓ | ✓ |
| 14 | **Genius** | scrape `genius.com/{Artist-Title-lyrics}` (HTML + `__PRELOADED_STATE__` JSON) | – | – | – | ✓ |
| 15 | **LyricFind** | `lyrics.lyricfind.com/api/v1/{search,metadata}` + optional official `api.lyricfind.com` | optional | – | – | ✓ |
| 16 | **YouTubeMusic** | innerTube `music.youtube.com/youtubei/v1/{search,next,browse}` | optional cookies | ✓ | – | ✓ |
| 17 | **YouTubeCaptions** | innerTube `player` → `timedtext?fmt=json3` | optional cookies | ✓ | – | ✓ |

## Configuration

### Spotify (optional)

Without credentials, Spotify falls back to Musixmatch internally. Set both to use the official Spotify color-lyrics endpoint:

```bash
export SPOTIFY_CLIENT_ID=...
export SPOTIFY_CLIENT_SECRET=...
```

### LyricFind (optional)

Without `LYRICFIND_API_KEY`, returns a 4-line **snippet preview** from the public `lyrics.lyricfind.com/api/v1/search` endpoint. With the key, uses the official OAuth flow and returns full lyrics:

```bash
export LYRICFIND_API_KEY=...
export LYRICFIND_TERRITORY=us   # ISO-2 code; auto-detected via IP if not set
```

### YouTube Music & Captions (optional cookies)

Both providers return `LOGIN_REQUIRED` without authentication. To get real lyrics, export browser cookies from a logged-in YouTube Music session:

```bash
export YT_MUSIC_COOKIES="SID=...; HSID=...; SSID=...; SAPISID=...; __Secure-3PAPISID=..."
```

### Proxy Rotation

Set `PROXY_URLS` to a comma- or space-separated list of HTTP/HTTPS proxies:

```bash
export PROXY_URLS="http://user:pass@proxy1.example.com:8080,http://proxy2.example.com:3128"
```

Connection is made via HTTP CONNECT tunnel over raw `net.Socket` (no `undici` or other dependencies). Basic auth is supported. Proxies that fail 3 times are blacklisted from rotation for the rest of the process lifetime.

Providers that consume the proxy list:

- **LyricFind** — rotates on 429/403, auto-detects territory via `api.iplocation.net` (cached 1h)
- **YouTubeMusic / YouTubeCaptions** — bypasses PoToken / IP-bound checks

## Programmatic API

### `LyricsManager`

```ts
new LyricsManager({
  providers?: string[];                    // default: all 17
  spotify?: { clientId?: string; clientSecret?: string };
  lyricfind?: { apiKey?: string; territory?: string; limit?: number; autoTerritory?: boolean; proxies?: ProxyEndpoint[] };
  youtubeMusic?: { cookies?: string };
  youtubeCaptions?: { cookies?: string; preferManualCaptions?: boolean };
  proxies?: ProxyEndpoint[];               // or load from PROXY_URLS env
  preferSynced?: boolean;                  // default: true
});
```

Methods:

- `initialize()` — sets up all providers (e.g. fetches OAuth tokens)
- `getLyrics(query)` — returns the first non-empty `LyricsResult` from the provider chain
- `getFromProvider(name, query)` — calls a single provider explicitly
- `list()` — returns the active provider name list

### `LyricsResult`

```ts
{
  lines: { text: string; time: number; duration: number }[];
  name?: string;
  artist?: string;
  album?: string;
  duration?: number;
  provider: string;
  synced: boolean;
}
```

## Reliability Notes

- **YouTube Music & Captions** — return empty without `YT_MUSIC_COOKIES` (innerTube `player` returns `LOGIN_REQUIRED`)
- **LyricFind** — without `LYRICFIND_API_KEY`, returns a 3-4 line snippet preview, not full lyrics
- **Genius** — Cloudflare challenge (HTTP 403) per IP. Auto-backoff 5 minutes after 4 consecutive 403s
- **YouLyPlus** — variance per run; any of the 6 mirrors may be down. Per-mirror timeout 6s
- **LetrasMus** — PT-BR focused; limited Indo / J-pop catalog
- **Paxsenix non-Apple endpoints** (`/musixmatch`, `/spotify`, `/netease`) — all forbidden; only `/apple-music/lyrics` is active

## Project Structure

```
src/
├── index.ts              # LyricsManager + all provider exports
├── types.ts              # shared types
├── example.ts            # CLI usage demo
├── test.ts               # CLI test all 17 providers
├── providers/
│   ├── applemusic.ts
│   ├── betterlyrics.ts
│   ├── binilyrics.ts
│   ├── genius.ts
│   ├── kugou.ts
│   ├── letrasmus.ts
│   ├── lrclib.ts
│   ├── lyricfind.ts
│   ├── lyricsovh.ts
│   ├── musixmatch.ts
│   ├── netease.ts
│   ├── qqmusic.ts
│   ├── spotify.ts
│   ├── unison.ts
│   ├── youlyplus.ts
│   ├── youtubecaptions.ts
│   └── youtubemusic.ts
└── utils/
    ├── http.ts           # makeRequest + IPv4 + proxy support
    ├── proxy.ts          # HTTP CONNECT tunnel + IP geolocation
    └── text.ts           # parseLrc, isSyncedLrc, stripQuery, etc.
```

## Scripts

```bash
npm run build       # compile TypeScript to ./dist
npm run typecheck   # type check only (no emit)
npm test -- "..."   # run CLI test against all 17 providers
```

## License

MIT
