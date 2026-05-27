import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { makeFakeClock } from '../../src/adapters/clock/fake.js';

describe('SessionRegistry', () => {
  let clock: ReturnType<typeof makeFakeClock>;
  let registry: SessionRegistry;

  beforeEach(() => {
    clock = makeFakeClock(1_000);
    registry = new SessionRegistry(clock);
  });

  it('registers and looks up by id', () => {
    registry.register({ id: 's1', label: 'trader' });
    expect(registry.get('s1')?.label).toBe('trader');
  });

  it('emits attached on register', () => {
    const events: string[] = [];
    registry.on('attached', ({ session }) => events.push(session.id));
    registry.register({ id: 's1' });
    expect(events).toEqual(['s1']);
  });

  it('re-attach with same id overrides prior handle without emitting detached', () => {
    const detached: string[] = [];
    registry.on('detached', ({ sessionId }) => detached.push(sessionId));
    registry.register({ id: 's1', label: 'old', pid: 1 });
    clock.advance(100);
    const re = registry.register({ id: 's1', label: 'new', pid: 2 });
    expect(re.label).toBe('new');
    expect(re.pid).toBe(2);
    expect(detached).toEqual([]);
  });

  it('detach is idempotent', () => {
    const events: string[] = [];
    registry.on('detached', ({ sessionId }) => events.push(sessionId));
    registry.register({ id: 's1' });
    expect(registry.detach('s1')).toBe(true);
    expect(registry.detach('s1')).toBe(false);
    expect(events).toEqual(['s1']);
  });

  it('findByLabel ignores detached sessions', () => {
    registry.register({ id: 's1', label: 'foo' });
    registry.register({ id: 's2', label: 'foo' });
    registry.detach('s1');
    expect(registry.findByLabel('foo')?.id).toBe('s2');
  });

  it('list filters by status and label', () => {
    registry.register({ id: 'a', label: 'x' });
    registry.register({ id: 'b', label: 'x' });
    registry.register({ id: 'c', label: 'y' });
    registry.detach('a');

    const attached = registry.list({ status: 'attached' });
    expect(attached.map((s) => s.id).sort()).toEqual(['b', 'c']);
    const detached = registry.list({ status: 'detached' });
    expect(detached.map((s) => s.id)).toEqual(['a']);
    const xs = registry.list({ label: 'x' });
    expect(xs.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('heartbeat refreshes lastHeartbeatAt', () => {
    registry.register({ id: 's1' });
    clock.advance(1000);
    registry.heartbeat('s1');
    expect(registry.get('s1')?.lastHeartbeatAt).toBe(2_000);
  });

  it('evictStale moves stale attached sessions to detached', () => {
    registry.register({ id: 's1' });
    registry.register({ id: 's2' });
    clock.advance(60_000);
    registry.heartbeat('s2');
    const evicted = registry.evictStale(30_000);
    expect(evicted.map((s) => s.id)).toEqual(['s1']);
    expect(registry.get('s1')?.status).toBe('detached');
    expect(registry.get('s2')?.status).toBe('attached');
  });
});
