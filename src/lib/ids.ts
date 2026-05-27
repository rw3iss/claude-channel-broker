import { customAlphabet } from 'nanoid';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const jobId = customAlphabet(ALPHABET, 12);
export const sessionId = customAlphabet(ALPHABET, 16);
export const correlationId = customAlphabet(ALPHABET, 12);
