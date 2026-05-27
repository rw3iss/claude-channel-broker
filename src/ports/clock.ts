export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
}
