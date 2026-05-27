import { loadConfig } from '../lib/config.js';
import type { Config } from '../../config/schema.js';

export interface ClientOptions {
  config?: string;
}

export interface ResolvedClient {
  config: Config;
  baseUrl: string;
  authHeader: { authorization: string };
}

export function resolveClient(opts: ClientOptions): ResolvedClient {
  const config = loadConfig({ path: opts.config });
  const baseUrl = `http://${config.broker.http.host}:${config.broker.http.port}`;
  return {
    config,
    baseUrl,
    authHeader: { authorization: `Bearer ${config.broker.http.auth_token}` },
  };
}

export async function httpJson(
  client: ResolvedClient,
  method: 'GET' | 'POST' | 'DELETE',
  pathname: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${client.baseUrl}${pathname}`, {
    method,
    headers: {
      ...client.authHeader,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

export function dieOnError(
  result: { status: number; body: any },
  failPrefix: string,
): void {
  if (result.status >= 400) {
    const code = result.body?.error?.code ?? result.status;
    const msg = result.body?.error?.message ?? JSON.stringify(result.body);
    console.error(`${failPrefix} (${code}): ${msg}`);
    process.exit(1);
  }
}
