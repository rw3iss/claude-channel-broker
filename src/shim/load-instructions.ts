import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const USER_CONFIG = path.join(
  os.homedir(),
  '.config',
  'claude-channel',
  'config.yaml',
);

/**
 * Load the channel protocol instructions for the shim to inject into its
 * MCP server. Tries, in order: user override, env var, shipped default.
 *
 * Reads YAML only — does NOT validate the full broker config schema. The
 * shim only needs the `instructions` and `instructions_append` fields, so
 * we deliberately don't require things like `auth_token`.
 */
export function loadInstructions(): string | undefined {
  const envOverride = process.env.CLAUDE_CHANNEL_INSTRUCTIONS_FILE;
  const candidates = [envOverride, USER_CONFIG, ...shippedDefaultCandidates()]
    .filter(Boolean) as string[];

  for (const candidate of candidates) {
    const text = readIfExists(candidate);
    if (!text) continue;
    try {
      const parsed = YAML.parse(text) as {
        instructions?: string;
        instructions_append?: string;
      };
      const base = parsed.instructions?.trim();
      if (!base) continue;
      const extra = parsed.instructions_append?.trim();
      return extra ? `${base}\n\n${extra}` : base;
    } catch {
      // Bad YAML — try the next candidate.
    }
  }
  return undefined;
}

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function shippedDefaultCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // From dist build: dist/src/shim/load-instructions.js → dist/config/default.yaml
  // From source:     src/shim/load-instructions.ts      → ./config/default.yaml
  return [
    path.resolve(here, '..', '..', 'config', 'default.yaml'),
    path.resolve(here, '..', '..', '..', 'config', 'default.yaml'),
    path.resolve(here, '..', '..', '..', '..', 'config', 'default.yaml'),
  ];
}
