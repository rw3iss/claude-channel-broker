/**
 * Tool definitions the shim exposes to Claude. Adding a new tool here:
 *   1. Append it to `DEFAULT_TOOLS`.
 *   2. Add a matching `case` to `SocketServer.dispatchToolCall` in
 *      src/broker/socket-server.ts so the broker knows how to route it.
 *   3. Update the instructions in config/default.yaml so Claude knows
 *      when to call it.
 */
export interface ToolDef {
  name: string;
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
