import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../../config/schema.js';
import type { Clock } from '../ports/clock.js';
import type { JobStore } from '../ports/job-store.js';
import type { JobDispatcher, DispatchSink } from '../ports/job-dispatcher.js';
import type { Logger } from '../ports/logger.js';
import { realClock } from '../adapters/clock/real.js';
import { makePinoLogger } from '../adapters/logger/pino.js';
import { SqliteJobStore } from '../adapters/job-store/sqlite.js';
import { InProcessJobDispatcher } from '../adapters/job-dispatcher/inproc.js';
import { SessionRegistry } from '../broker/session-registry.js';
import { SseBus } from '../broker/sse-bus.js';
import { JobService } from '../broker/job-service.js';

export interface Container {
  config: Config;
  clock: Clock;
  logger: Logger;
  store: JobStore;
  sessions: SessionRegistry;
  bus: SseBus;
  dispatcher: JobDispatcher;
  service: JobService;
  /**
   * The dispatch sink isn't wired until SocketServer comes online, since
   * the sink is the SocketServer itself. The container exposes a pluggable
   * holder so bootstrap can wire it after construction.
   */
  setDispatchSink(sink: DispatchSink): void;
  dispose(): Promise<void>;
}

export interface ContainerOverrides {
  clock?: Clock;
  logger?: Logger;
  store?: JobStore;
}

export async function buildContainer(
  config: Config,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  const clock = overrides.clock ?? realClock;
  const logger =
    overrides.logger ??
    makePinoLogger({
      level: config.logging.level,
      pretty: config.logging.pretty,
    });

  const store = overrides.store ?? (await buildJobStore(config, clock));

  const sessions = new SessionRegistry(clock);
  const bus = new SseBus();

  let dispatchSink: DispatchSink = {
    async send() {
      throw new Error(
        'DispatchSink not wired yet — call container.setDispatchSink(...)',
      );
    },
  };

  if (config.dispatch.driver === 'bullmq') {
    // Trigger the helpful "not implemented" error from the stub.
    const { BullMqJobDispatcher } = await import(
      '../adapters/job-dispatcher/bullmq.js'
    );
    void new BullMqJobDispatcher({
      redis: config.dispatch.bullmq.redis,
      queue: config.dispatch.bullmq.queue,
    });
  }

  const dispatcher = new InProcessJobDispatcher({
    store,
    sink: {
      async send(sessionId, msg) {
        await dispatchSink.send(sessionId, msg);
      },
    },
    sessionGate: {
      isAttached: (id) => sessions.get(id)?.status === 'attached',
    },
    clock,
    logger: logger.child({ comp: 'dispatcher' }),
  });

  const service = new JobService({
    store,
    dispatcher,
    sessions,
    bus,
    clock,
    logger: logger.child({ comp: 'job-service' }),
    defaults: {
      job_ttl_sec: config.broker.defaults.job_ttl_sec,
      client_ref_window_sec: config.broker.defaults.client_ref_window_sec,
    },
  });

  sessions.on('attached', ({ session }) => {
    void dispatcher.notifySessionAttached(session.id);
  });

  return {
    config,
    clock,
    logger,
    store,
    sessions,
    bus,
    dispatcher,
    service,
    setDispatchSink(sink) {
      dispatchSink = sink;
    },
    async dispose() {
      await dispatcher.stop();
      await store.close();
    },
  };
}

async function buildJobStore(config: Config, clock: Clock): Promise<JobStore> {
  if (config.storage.job_store.driver === 'sqlite') {
    return new SqliteJobStore({
      path: config.storage.job_store.sqlite.path,
      clock,
      migrationsDir: resolveMigrationsDir(),
    });
  }
  if (config.storage.job_store.driver === 'postgres') {
    const { PostgresJobStore } = await import(
      '../adapters/job-store/postgres.js'
    );
    return new PostgresJobStore({
      url: config.storage.job_store.postgres.url,
      clock,
    });
  }
  throw new Error(
    `Unknown job_store driver: ${JSON.stringify(config.storage.job_store)}`,
  );
}

function resolveMigrationsDir(): string {
  const override = process.env.CLAUDE_CHANNEL_MIGRATIONS_DIR;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(
        `CLAUDE_CHANNEL_MIGRATIONS_DIR is set but does not exist: ${override}`,
      );
    }
    return override;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Probe likely locations relative to this file's location at runtime:
  //   - dist build:   dist/src/lib/container.js → ../../../migrations
  //   - source tree:  src/lib/container.ts      → ../../migrations
  //   - dist-flat:    dist/lib/container.js     → ../../migrations
  const candidates = [
    path.resolve(here, '..', '..', 'migrations'),
    path.resolve(here, '..', '..', '..', 'migrations'),
    path.resolve(here, '..', '..', '..', '..', 'migrations'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate migrations directory. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}\nIf running from a non-standard layout, set CLAUDE_CHANNEL_MIGRATIONS_DIR.`,
  );
}
