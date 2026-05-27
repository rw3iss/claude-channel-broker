import type { Clock } from '../../ports/clock.js';

export interface FakeClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

export function makeFakeClock(start = 0): FakeClock {
  let current = start;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
