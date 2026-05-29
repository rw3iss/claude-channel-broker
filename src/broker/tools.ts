/**
 * The channel tool contract — the tools the shim exposes to Claude over MCP,
 * and the names the broker routes. Lives in `broker/` (like `wire.ts`) because
 * it is shared protocol: the shim reaches in for the schemas, the broker's
 * tool-router keys its handlers off `ToolName`.
 *
 * `ToolName` is the single source of truth for which tools exist. Adding one:
 *   1. Add its name to `ToolName` and an entry to `DEFAULT_TOOLS`.
 *   2. Add a handler to `TOOL_HANDLERS` in `tool-router.ts` — its
 *      `Record<ToolName, …>` type fails to compile until you do, so the
 *      schema list and the routing can't drift.
 *   3. Update the instructions in `config/default.yaml` so Claude knows when
 *      to call it.
 */
export type ToolName = 'complete_job' | 'fail_job' | 'note_progress' | 'ack_job';

export interface ToolDef {
  name: ToolName;
  description: string;
  inputSchema: object;
}

export const DEFAULT_TOOLS: ToolDef[] = [
  {
    name: 'complete_job',
    description:
      "Mark a channel job as completed. Call this when you've finished the work the channel event described. `result` becomes the structured payload returned to the submitter.",
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'job_id from the channel event' },
        result: {
          description: 'Final answer. Can be a string or any JSON-serializable object.',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'fail_job',
    description:
      "Mark a channel job as failed. Call this if you can't complete the request.",
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'job_id from the channel event' },
        error: { type: 'string', description: 'Human-readable reason' },
      },
      required: ['job_id', 'error'],
    },
  },
  {
    name: 'note_progress',
    description:
      'Add a progress note to a channel job. Optional. Use this to stream updates to the submitter during long-running work.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['job_id', 'note'],
    },
  },
  {
    name: 'ack_job',
    description:
      'Acknowledge receipt of a channel job. Use this to flip the job from "dispatched" to "in_progress" so the submitter knows you started working.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
      },
      required: ['job_id'],
    },
  },
];
