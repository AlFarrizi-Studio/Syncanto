import * as net from 'node:net';
import * as tls from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import type { RequestResponse } from '../types';

export type ProxyProtocol = 'http' | 'https';

export interface ProxyEndpoint {
  url: string;
  protocol?: ProxyProtocol;
  failures?: number;
  lastUsed?: number;
}

let proxyCursor = 0;
const proxyState = new Map<string, ProxyEndpoint>();

function parseProxy(url: string): { host: string; port: number; auth?: string; protocol: ProxyProtocol } {
  const u = new URL(url);
  const protocol: ProxyProtocol = u.protocol === 'https:' ? 'https' : 'http';
  const auth = u.username
    ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
    : undefined;
  return { host: u.hostname, port: Number(u.port || (protocol === 'https' ? 443 : 8080)), auth, protocol };
}

export function loadProxies(envVar = 'PROXY_URLS'): ProxyEndpoint[] {
  const raw = process.env[envVar];
  if (!raw) return [];
  const list = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const endpoints = list.map((url) => ({ url, protocol: 'http' as ProxyProtocol, failures: 0 }));
  for (const ep of endpoints) proxyState.set(ep.url, ep);
  return endpoints;
}

export function pickProxy(proxies: ProxyEndpoint[]): ProxyEndpoint | null {
  const live = proxies.filter((p) => (p.failures || 0) < 3);
  if (!live.length) return null;
  let best: ProxyEndpoint | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < live.length; i++) {
    const p = live[i]!;
    const age = p.lastUsed ? (Date.now() - p.lastUsed) / 1000 : 999;
    const score = age + i * 0.001 - (p.failures || 0) * 10;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return null;
  best.lastUsed = Date.now();
  return best;
}

export function markProxyFailure(proxy: ProxyEndpoint): void {
  proxy.failures = (proxy.failures || 0) + 1;
}

export function markProxySuccess(proxy: ProxyEndpoint): void {
  proxy.failures = 0;
}

export function buildTunnel(
  proxyUrl: string,
  target: { host: string; port: number; protocol: 'http:' | 'https:' }
): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const proxy = parseProxy(proxyUrl);
    const socket = net.connect({ host: proxy.host, port: proxy.port }, () => {
      const connectReq =
        `CONNECT ${target.host}:${target.port} HTTP/1.1\r\n` +
        `Host: ${target.host}:${target.port}\r\n` +
        (proxy.auth ? `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n` : '') +
        `\r\n`;
      socket.write(connectReq);
    });

    let buffer = '';
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
    };

    socket.once('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.once('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const head = buffer.slice(0, idx);
      const statusLine = head.split('\r\n')[0] || '';
      const ok = /^HTTP\/1\.[01]\s+2\d\d/.test(statusLine);
      cleanup();
      if (!ok) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: ${statusLine}`));
        return;
      }
      if (target.protocol === 'https:') {
        const tlsSocket = tls.connect({
          socket,
          servername: target.host,
          rejectUnauthorized: false
        });
        tlsSocket.once('secureConnect', () => resolve(tlsSocket));
        tlsSocket.once('error', (err) => {
          tlsSocket.destroy();
          reject(err);
        });
      } else {
        resolve(socket);
      }
    });
  });
}

export interface ProxiedRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeout?: number;
  proxy?: ProxyEndpoint | null;
}

export function proxiedRequest<T = unknown>(
  url: string,
  opts: ProxiedRequestOptions = {}
): Promise<RequestResponse<T>> {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const proxy = opts.proxy;
  const controller = new AbortController();
  const timeout = opts.timeout ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  return new Promise((resolve) => {
    const finish = (payload: RequestResponse<T>) => {
      clearTimeout(timer);
      resolve(payload);
    };

    const send = (socket: net.Socket | tls.TLSSocket | null) => {
      const mergedHeaders: Record<string, string> = {
        Host: `${u.hostname}${u.port ? ':' + u.port : ''}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...opts.headers
      };
      const reqOpts: http.RequestOptions = {
        host: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        agent: false,
        headers: mergedHeaders
      } as http.RequestOptions;
      if (socket) (reqOpts as http.RequestOptions & { socket: net.Socket | tls.TLSSocket }).socket = socket;
      const req = (lib as typeof http | typeof https).request(reqOpts, (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          const ct = (r.headers['content-type'] || r.headers['Content-Type'] || '') as string;
          let parsed: unknown = text;
          const trimmed = text.trim();
          if (
            ct.includes('application/json') ||
            ct.includes('text/json') ||
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
          ) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          const headers: Record<string, string> = {};
          Object.entries(r.headers).forEach(([k, v]) => {
            if (typeof v === 'string') headers[k.toLowerCase()] = v;
          });
          const setCookie = (r.headers['set-cookie'] || r.headers['Set-Cookie']) as
            | string
            | string[]
            | undefined;
          finish({
            statusCode: r.statusCode || 0,
            body: parsed as T,
            headers,
            raw: text,
            setCookie: setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : undefined
          });
        });
        r.on('error', () => finish({ statusCode: 0, body: null as unknown as T, headers: {}, error: 'response error' }));
      });
      req.on('error', (err: Error) => {
        finish({ statusCode: 0, body: null as unknown as T, headers: {}, error: err.message });
      });
      if (opts.body) req.write(opts.body);
      req.setTimeout(timeout, () => req.destroy());
      req.end();
    };

    if (proxy) {
      buildTunnel(proxy.url, { host: u.hostname, port: reqPort(u), protocol: u.protocol as 'http:' | 'https:' })
        .then(send)
        .catch((err: Error) => finish({ statusCode: 0, body: null as unknown as T, headers: {}, error: err.message }));
    } else {
      send(null as unknown as net.Socket);
    }
  });
}

function reqPort(u: URL): number {
  if (u.port) return Number(u.port);
  return u.protocol === 'https:' ? 443 : 80;
}

let cachedIpCountry: { country: string; ip: string; fetchedAt: number } | null = null;
const IP_LOOKUP_TTL_MS = 60 * 60 * 1000;

export async function detectCountry(
  ipLookupUrl = 'https://api.iplocation.net/?cmd=get-ip',
  geoLookupUrl = 'https://api.iplocation.net/'
): Promise<{ ip: string; country: string }> {
  if (cachedIpCountry && Date.now() - cachedIpCountry.fetchedAt < IP_LOOKUP_TTL_MS) {
    return { ip: cachedIpCountry.ip, country: cachedIpCountry.country };
  }
  const ipResp = await proxiedRequest<{ ip?: string }>(ipLookupUrl);
  const ip = ipResp.body?.ip || '1.1.1.1';
  const geoResp = await proxiedRequest<{ country_code2?: string }>(geoLookupUrl, {
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    body: JSON.stringify({ ip })
  });
  const country = geoResp.body?.country_code2 || 'US';
  cachedIpCountry = { ip, country, fetchedAt: Date.now() };
  return { ip, country };
}

export function resetIpCache(): void {
  cachedIpCountry = null;
}

export function getProxyState(): Map<string, ProxyEndpoint> {
  return proxyState;
}

export function setProxyCursor(idx: number): void {
  proxyCursor = idx;
}

export function getProxyCursor(): number {
  return proxyCursor;
}