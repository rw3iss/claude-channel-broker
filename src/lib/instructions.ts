import type { Config } from '../../config/schema.js';

/**
 * Combine a base instructions string with an optional project-specific
 * append. Trims both and joins with a blank line. The single source of
 * truth for how `instructions` + `instructions_append` become one string —
 * used by both the broker (from parsed config) and the shim (from raw YAML).
 *
 * Lives in `lib/` so both tiers can depend on it without the shim importing
 * from `broker/` (or vice versa).
 */
export function combineInstructions(base: string, append?: string): string {
  const b = base.trim();
  const extra = append?.trim();
  return extra ? `${b}\n\n${extra}` : b;
}

/** Build the shim instructions string from a fully-parsed broker Config. */
export function buildInstructions(config: Config): string {
  return combineInstructions(config.instructions, config.instructions_append);
}
