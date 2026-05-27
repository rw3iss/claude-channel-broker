#!/usr/bin/env node
/**
 * Tiny HTTP server that forwards every POST it receives into the broker
 * as a channel job. Useful for wiring GitHub webhooks, file watchers,
 * etc. into a Claude session.
 *
 *   CLAUDE_BROKER_TOKEN=secret SESSION_LABEL=my-session PORT=4191 \
 *     npx tsx examples/webhook.ts
 */
import http from 'node:http';
import process from 'node:process';

const broker = process.env.BROKER ?? 'http://127.0.0.1:4180';
const token = process.env.CLAUDE_BROKER_TOKEN;
const label = process.env.SESSION_LABEL;
const port = Number(process.env.PORT ?? '4191');

if (!token || !label) {
  console.error('CLAUDE_BROKER_TOKEN and SESSION_LABEL are required');
  process.exit(2);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const r = await fetch(`${broker}/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_label: label,
      content: `Incoming webhook payload:\n${body}`,
      meta: { source: 'webhook', path: req.url ?? '/' },
    }),
  });
  res.writeHead(r.status, { 'content-type': 'application/json' });
  res.end(await r.text());
});

server.listen(port, () => {
  console.error(`webhook → broker @ ${broker} forwarder on :${port} (label=${label})`);
});
