#!/usr/bin/env node
/**
 * One-shot example: submit a job and wait for the result.
 *
 *   CLAUDE_CHANNEL_TOKEN=secret BROKER=http://127.0.0.1:4180 \
 *     npx tsx examples/one-shot.ts trader-debug "Investigate slow /trade"
 */
import process from 'node:process';

const broker = process.env.BROKER ?? 'http://127.0.0.1:4180';
const token = process.env.CLAUDE_CHANNEL_TOKEN;
if (!token) {
  console.error('CLAUDE_CHANNEL_TOKEN is required');
  process.exit(2);
}

const [, , sessionLabel, ...rest] = process.argv;
if (!sessionLabel || rest.length === 0) {
  console.error('usage: one-shot.ts <session_label> <content...>');
  process.exit(2);
}
const content = rest.join(' ');

const auth = { authorization: `Bearer ${token}` };

const submit = await fetch(`${broker}/jobs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({ session_label: sessionLabel, content }),
});
if (!submit.ok) {
  console.error(`submit failed: ${submit.status} ${await submit.text()}`);
  process.exit(1);
}
const { job_id } = (await submit.json()) as { job_id: string };
console.error(`# submitted job ${job_id}; waiting...`);

const waited = await fetch(`${broker}/jobs/${job_id}/wait?timeout=120`, {
  headers: auth,
});
const body = (await waited.json()) as {
  status: string;
  result: unknown;
  error: string | null;
  timed_out: boolean;
};
console.log(JSON.stringify(body, null, 2));
process.exit(body.status === 'completed' ? 0 : 1);
