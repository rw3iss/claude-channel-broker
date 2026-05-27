/**
 * Substitute `${VAR}` references with environment-variable values.
 * Throws if a referenced var is unset and no default is provided.
 *
 * Syntax:
 *   ${VAR}             — required; throws if unset
 *   ${VAR:-fallback}   — falls back to literal string if unset/empty
 */
export function interpolateEnv(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
    const value = env[name];
    if (value !== undefined && value !== '') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment variable ${name} is required but not set`);
  });
}
