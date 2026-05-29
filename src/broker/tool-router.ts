import type { JobStatus } from '../ports/types.js';
import type { JobService, ToolCallContext } from './job-service.js';
import type { ToolName } from './tools.js';

export interface ToolResult {
  ok: true;
  status: JobStatus;
}

type ToolHandler = (
  service: JobService,
  jobId: string,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
) => Promise<ToolResult>;

/**
 * Broker-side routing for each channel tool. Typed as `Record<ToolName, …>`
 * so the compiler guarantees every declared tool has a handler (and vice
 * versa) — the schema list in `tools.ts` and this map cannot drift.
 */
const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  complete_job: async (service, jobId, args, ctx) => {
    const job = await service.complete(jobId, args.result, ctx);
    return { ok: true, status: job.status };
  },
  fail_job: async (service, jobId, args, ctx) => {
    const error =
      typeof args.error === 'string' ? args.error : JSON.stringify(args.error);
    const job = await service.fail(jobId, error, ctx);
    return { ok: true, status: job.status };
  },
  note_progress: async (service, jobId, args, ctx) => {
    const note =
      typeof args.note === 'string' ? args.note : JSON.stringify(args.note);
    const job = await service.noteProgress(jobId, note, ctx);
    return { ok: true, status: job.status };
  },
  ack_job: async (service, jobId, _args, ctx) => {
    const job = await service.ack(jobId, ctx);
    return { ok: true, status: job.status };
  },
};

/**
 * Route a tool call from a shim to the JobService. Throws on an unknown
 * tool name or a missing `job_id` — the caller maps the throw to a
 * `toolResult` error.
 */
export async function dispatchTool(
  service: JobService,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<ToolResult> {
  const handler = (TOOL_HANDLERS as Record<string, ToolHandler | undefined>)[name];
  if (!handler) throw new Error(`unknown tool: ${name}`);
  const jobId = typeof args.job_id === 'string' ? args.job_id : null;
  if (!jobId) throw new Error('job_id is required');
  return handler(service, jobId, args, ctx);
}
