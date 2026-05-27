import pino from 'pino';
import type { Logger, LogLevel } from '../../ports/logger.js';

export interface PinoLoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
  destination?: pino.DestinationStream;
}

export function makePinoLogger(opts: PinoLoggerOptions = {}): Logger {
  const pretty = opts.pretty ?? true;
  const level = opts.level ?? 'info';

  const inner = pretty
    ? pino(
        { level },
        pino.transport({
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }),
      )
    : pino({ level }, opts.destination ?? pino.destination(1));

  return wrap(inner);
}

function wrap(inner: pino.Logger): Logger {
  return {
    trace: (obj, msg) => emit(inner, 'trace', obj, msg),
    debug: (obj, msg) => emit(inner, 'debug', obj, msg),
    info: (obj, msg) => emit(inner, 'info', obj, msg),
    warn: (obj, msg) => emit(inner, 'warn', obj, msg),
    error: (obj, msg) => emit(inner, 'error', obj, msg),
    child: (bindings) => wrap(inner.child(bindings)),
  };
}

function emit(
  inner: pino.Logger,
  level: pino.Level,
  obj: object | string,
  msg?: string,
): void {
  if (typeof obj === 'string') {
    inner[level](obj);
  } else {
    inner[level](obj, msg);
  }
}

export function silentLogger(): Logger {
  const noop = () => undefined;
  const log: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => log,
  };
  return log;
}
