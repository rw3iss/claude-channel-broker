import type { Config } from '../../config/schema.js';

/**
 * Build the instructions string the shim passes to its MCP Server.
 * Combines the canonical `instructions` field with the optional
 * `instructions_append` for project-specific guidance.
 */
export function buildInstructions(config: Config): string {
  const base = config.instructions.trim();
  const extra = config.instructions_append?.trim();
  return extra ? `${base}\n\n${extra}` : base;
}
