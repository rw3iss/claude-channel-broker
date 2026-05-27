/**
 * Broker ↔ shim wire protocol — line-delimited JSON.
 * See plan §7.
 */

export const WIRE_VERSION = 1 as const;

export interface ShimRegisterMessage {
  v: 1;
  type: 'register';
  sessionId: string;
  label?: string | null;
  pid?: number;
  version?: string;
  instructions?: string;
  capabilities?: string[];
}

export interface ShimHeartbeatMessage {
  v: 1;
  type: 'heartbeat';
}

export interface ShimToolCallMessage {
  v: 1;
  type: 'toolCall';
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ShimReconnectMessage {
  v: 1;
  type: 'reconnect';
  sessionId: string;
  inFlightJobIds: string[];
}

export type ShimToBrokerMessage =
  | ShimRegisterMessage
  | ShimHeartbeatMessage
  | ShimToolCallMessage
  | ShimReconnectMessage;

export interface BrokerRegisteredMessage {
  v: 1;
  type: 'registered';
  sessionId: string;
  instructionsToInject?: string;
}

export interface BrokerDispatchMessage {
  v: 1;
  type: 'dispatch';
  jobId: string;
  content: string;
  meta: Record<string, string>;
}

export interface BrokerCancelMessage {
  v: 1;
  type: 'cancel';
  jobId: string;
}

export interface BrokerCommentMessage {
  v: 1;
  type: 'comment';
  jobId: string;
  note: string;
}

export interface BrokerToolResultMessage {
  v: 1;
  type: 'toolResult';
  id: string;
  result?: unknown;
  error?: string;
}

export interface BrokerShutdownMessage {
  v: 1;
  type: 'shutdown';
  reason: string;
}

export interface BrokerErrorMessage {
  v: 1;
  type: 'error';
  code: string;
  message: string;
  /** Correlation id, if the error is in response to a request. */
  id?: string;
}

export type BrokerToShimMessage =
  | BrokerRegisteredMessage
  | BrokerDispatchMessage
  | BrokerCancelMessage
  | BrokerCommentMessage
  | BrokerToolResultMessage
  | BrokerShutdownMessage
  | BrokerErrorMessage;

export function encodeMessage(msg: object): string {
  return JSON.stringify(msg) + '\n';
}

export function parseLine<T>(line: string): T {
  return JSON.parse(line) as T;
}
