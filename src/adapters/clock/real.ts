import type { Clock } from '../../ports/clock.js';

export const realClock: Clock = {
  now: () => Date.now(),
};
