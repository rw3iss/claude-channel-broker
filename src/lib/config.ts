import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { interpolateEnv } from './env.js';

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'claude-channel',
  'config.yaml',
);

export const SHIPPED_DEFAULT_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  'config',
  'default.yaml',
);

export interface LoadConfigOptions {
  /** Override config path. */
  path?: string;
  /** Fall back to the shipped default if no user config exists. Defaults to true. */
  fallbackToDefault?: boolean;
  /** Env source (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const fallback = opts.fallbackToDefault ?? true;

  let source: string;
  let sourcePath: string;

  if (opts.path) {
    sourcePath = opts.path;
    source = fs.readFileSync(opts.path, 'utf8');
  } else if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    sourcePath = DEFAULT_CONFIG_PATH;
    source = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
  } else if (fallback) {
    sourcePath = SHIPPED_DEFAULT_PATH;
    source = fs.readFileSync(SHIPPED_DEFAULT_PATH, 'utf8');
  } else {
    throw new Error(
      `No config file found at ${DEFAULT_CONFIG_PATH}. Pass --config to override.`,
    );
  }

  const interpolated = interpolateEnv(source, env);
  const parsed = YAML.parse(interpolated);

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid configuration in ${sourcePath}:\n${issues}`,
    );
  }
  return result.data;
}

export function loadConfigFromString(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const interpolated = interpolateEnv(source, env);
  const parsed = YAML.parse(interpolated);
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}
