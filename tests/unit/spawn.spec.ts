import { describe, it, expect } from 'vitest';
import { makeSpawnHelper } from '../../src/broker/spawn.js';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { makeFakeClock } from '../../src/adapters/clock/fake.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';

describe('makeSpawnHelper', () => {
  it('returns sessionId when a shim with the label attaches', async () => {
    const clock = makeFakeClock(0);
    const sessions = new SessionRegistry(clock);
    const helper = makeSpawnHelper({
      sessions,
      clock,
      logger: silentLogger(),
      claudeBinary: 'echo', // benign no-op binary that exits immediately
      timeoutMs: 1000,
      pollIntervalMs: 25,
    });

    // Register the shim shortly after invoking the helper.
    setTimeout(() => {
      sessions.register({ id: 'spawn-1', label: 'late' });
    }, 50);

    const result = await helper({ label: 'late' });
    expect(result.sessionId).toBe('spawn-1');
  });

  it('throws TimeoutError when label never appears', async () => {
    const clock = makeFakeClock(0);
    const sessions = new SessionRegistry(clock);
    const helper = makeSpawnHelper({
      sessions,
      clock,
      logger: silentLogger(),
      claudeBinary: 'echo',
      timeoutMs: 100,
      pollIntervalMs: 25,
    });

    // The fake clock won't advance on its own; the helper uses `clock.now()`
    // for the deadline, so we need to advance it during polling.
    const handle = setInterval(() => clock.advance(50), 25);
    try {
      await expect(helper({ label: 'missing' })).rejects.toThrow(/timed out/);
    } finally {
      clearInterval(handle);
    }
  });
});
