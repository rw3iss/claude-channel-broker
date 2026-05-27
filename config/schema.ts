import { z } from 'zod';

export const HttpConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(4180),
  auth_token: z.string().min(1),
});

export const SocketConfigSchema = z.object({
  path: z.string().default('/tmp/claude-broker.sock'),
});

export const BrokerDefaultsSchema = z.object({
  job_ttl_sec: z.number().int().positive().default(300),
  heartbeat_timeout_sec: z.number().int().positive().default(30),
  sweep_interval_sec: z.number().int().positive().default(30),
  long_poll_max_sec: z.number().int().positive().default(600),
  client_ref_window_sec: z.number().int().positive().default(86400),
  orphan_grace_sec: z.number().int().positive().default(120),
});

export const BrokerConfigSchema = z.object({
  http: HttpConfigSchema,
  socket: SocketConfigSchema.default({}),
  defaults: BrokerDefaultsSchema.default({}),
});

export const SqliteStoreConfigSchema = z.object({
  path: z.string().min(1),
});

export const PostgresStoreConfigSchema = z.object({
  url: z.string().url(),
});

export const JobStoreConfigSchema = z.discriminatedUnion('driver', [
  z.object({ driver: z.literal('sqlite'), sqlite: SqliteStoreConfigSchema }),
  z.object({
    driver: z.literal('postgres'),
    postgres: PostgresStoreConfigSchema,
  }),
]);

export const StorageConfigSchema = z.object({
  job_store: JobStoreConfigSchema,
});

export const DispatchConfigSchema = z.discriminatedUnion('driver', [
  z.object({ driver: z.literal('inproc') }),
  z.object({
    driver: z.literal('bullmq'),
    bullmq: z.object({
      redis: z.string().min(1),
      queue: z.string().min(1),
    }),
  }),
]);

export const LoggingConfigSchema = z.object({
  level: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  pretty: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  broker: BrokerConfigSchema,
  storage: StorageConfigSchema,
  dispatch: DispatchConfigSchema.default({ driver: 'inproc' }),
  logging: LoggingConfigSchema.default({}),
  instructions: z.string().min(1),
  instructions_append: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type BrokerConfig = z.infer<typeof BrokerConfigSchema>;
export type JobStoreConfig = z.infer<typeof JobStoreConfigSchema>;
export type DispatchConfig = z.infer<typeof DispatchConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
