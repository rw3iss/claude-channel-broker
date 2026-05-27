import { EventEmitter } from 'node:events';

export interface SseMessage<T = unknown> {
  topic: string;
  data: T;
  at: number;
}

export type SseHandler<T = unknown> = (msg: SseMessage<T>) => void;

/**
 * In-process publish/subscribe with topic prefixes. Subscribers receive
 * every message whose topic starts with their subscribed prefix, so
 * subscribing to `'job.'` catches `job.completed`, `job.failed`, etc.
 */
export class SseBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish<T = unknown>(topic: string, data: T, at: number = Date.now()): void {
    const msg: SseMessage<T> = { topic, data, at };
    this.emitter.emit('msg', msg);
  }

  subscribe<T = unknown>(prefix: string, handler: SseHandler<T>): () => void {
    const listener = (msg: SseMessage): void => {
      if (msg.topic.startsWith(prefix)) handler(msg as SseMessage<T>);
    };
    this.emitter.on('msg', listener);
    return () => this.emitter.off('msg', listener);
  }

  /**
   * Wait for the first message whose topic starts with `prefix` AND whose
   * data satisfies `predicate`. Resolves with the message or rejects if
   * the optional AbortSignal aborts.
   */
  waitFor<T = unknown>(
    prefix: string,
    predicate: (data: T) => boolean,
    options: { signal?: AbortSignal } = {},
  ): Promise<SseMessage<T>> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe<T>(prefix, (msg) => {
        if (predicate(msg.data)) {
          unsubscribe();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          resolve(msg);
        }
      });
      const onAbort = (): void => {
        unsubscribe();
        reject(new Error('aborted'));
      };
      if (options.signal) {
        if (options.signal.aborted) {
          unsubscribe();
          reject(new Error('aborted'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  listenerCount(): number {
    return this.emitter.listenerCount('msg');
  }
}
