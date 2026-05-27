import { describe, it, expect, beforeEach } from 'vitest';
import { SseBus } from '../../src/broker/sse-bus.js';

describe('SseBus', () => {
  let bus: SseBus;

  beforeEach(() => {
    bus = new SseBus();
  });

  it('delivers in order to subscribers', () => {
    const received: string[] = [];
    bus.subscribe<{ id: string }>('job.', (msg) => received.push(msg.data.id));
    bus.publish('job.created', { id: '1' });
    bus.publish('job.completed', { id: '2' });
    bus.publish('session.attached', { id: '3' });
    expect(received).toEqual(['1', '2']);
  });

  it('unsubscribe stops delivery', () => {
    const received: string[] = [];
    const off = bus.subscribe<{ id: string }>('job.', (msg) =>
      received.push(msg.data.id),
    );
    bus.publish('job.created', { id: '1' });
    off();
    bus.publish('job.completed', { id: '2' });
    expect(received).toEqual(['1']);
  });

  it('waitFor resolves when matching message arrives', async () => {
    const promise = bus.waitFor<{ id: string }>(
      'job.',
      (data) => data.id === 'target',
    );
    bus.publish('job.created', { id: 'other' });
    bus.publish('job.completed', { id: 'target' });
    const msg = await promise;
    expect(msg.topic).toBe('job.completed');
    expect(msg.data.id).toBe('target');
  });

  it('waitFor rejects when signal aborts', async () => {
    const ac = new AbortController();
    const p = bus.waitFor<{ id: string }>('job.', () => false, {
      signal: ac.signal,
    });
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it('topic prefix filtering — exact prefix only', () => {
    const received: string[] = [];
    bus.subscribe('job.completed', (msg) => received.push(msg.topic));
    bus.publish('job.completed', {});
    bus.publish('job.completed.extra', {});
    bus.publish('job.failed', {});
    expect(received).toEqual(['job.completed', 'job.completed.extra']);
  });

  it('listenerCount tracks subscribers', () => {
    const off1 = bus.subscribe('a', () => undefined);
    const off2 = bus.subscribe('b', () => undefined);
    expect(bus.listenerCount()).toBe(2);
    off1();
    expect(bus.listenerCount()).toBe(1);
    off2();
    expect(bus.listenerCount()).toBe(0);
  });
});
