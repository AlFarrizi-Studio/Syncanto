import type { RequestOptions, RequestResponse } from '../types';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import { type ProxyEndpoint, proxiedRequest } from './proxy';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ipv4Agent = new https.Agent({ family: 4 });
const ipv4HttpAgent = new http.Agent({ family: 4 });

function pickAgent(protocol: string): https.Agent | http.Agent {
  return protocol === 'http:' ? ipv4HttpAgent : ipv4Agent;
}

function rawRequest<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | URLSearchParams | undefined,
  timeout: number,
  signal: AbortSignal | undefined
): Promise<RequestResponse<T>> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const agent = pickAgent(u.protocol);
    const lib = u.protocol === 'https:' ? https : http;
    const mergedHeaders: Record<string, string> = {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        agent,
        headers: mergedHeaders
      },
      (r) => {
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
              if (trimmed.startsWith("'") || /^\{'\w+':/.test(trimmed)) {
                try {
                  const fixed = text
                    .replace(/'/g, '"')
                    .replace(/True/g, 'true')
                    .replace(/False/g, 'false')
                    .replace(/None/g, 'null');
                  parsed = JSON.parse(fixed);
                } catch {
                  parsed = text;
                }
              } else {
                parsed = text;
              }
            }
          }
          const responseHeaders: Record<string, string> = {};
          Object.entries(r.headers).forEach(([k, v]) => {
            if (typeof v === 'string') responseHeaders[k.toLowerCase()] = v;
          });
          const setCookie = (r.headers['set-cookie'] || r.headers['Set-Cookie']) as
            | string
            | string[]
            | undefined;
          resolve({
            statusCode: r.statusCode || 0,
            body: parsed as T,
            headers: responseHeaders,
            raw: text,
            setCookie: setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : undefined
          });
        });
        r.on('error', () => {
          resolve({ statusCode: 0, body: null as unknown as T, headers: {}, error: 'response error' });
        });
      }
    );
    req.on('error', (reqErr) => {
      const message = reqErr instanceof Error ? reqErr.message : String(reqErr);
      resolve({ statusCode: 0, body: null as unknown as T, headers: {}, error: message });
    });
    if (signal) {
      if (signal.aborted) req.destroy();
      else signal.addEventListener('abort', () => req.destroy());
    }
    if (body) req.write(body);
    req.setTimeout(timeout, () => req.destroy());
    req.end();
  });
}

export function makeRequest<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<RequestResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 15_000,
    signal,
    family,
    proxy
  } = options;

  if (proxy) {
    return proxiedRequest<T>(url, {
      method,
      headers,
      body,
      timeout,
      proxy: proxy as ProxyEndpoint
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }

  if (family === 4 || family === undefined) {
    return rawRequest<T>(url, method, headers, body, timeout, signal).finally(() =>
      clearTimeout(timer)
    );
  }

  return fetch(url, {
    method,
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    },
    body,
    signal: controller.signal,
    redirect: 'follow'
  })
    .then(async (res) => {
      clearTimeout(timer);
      const contentType = res.headers.get('content-type') || '';
      const raw = await res.text();
      let parsed: unknown = raw;

      if (contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return {
        statusCode: res.status,
        body: parsed as T,
        headers: responseHeaders,
        raw,
        setCookie: (res.headers.getSetCookie && res.headers.getSetCookie()) || undefined
      };
    })
    .catch((err: unknown) => {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      return { statusCode: 0, body: null as unknown as T, headers: {}, error: message };
    });
}

export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  tag: string,
  message: string
): void {
  const colors: Record<string, string> = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m'
  };
  const reset = '\x1b[0m';
  const color = colors[level] || '';
  // eslint-disable-next-line no-console
  console.log(`${color}[${level.toUpperCase()}][${tag}]${reset} ${message}`);
}
