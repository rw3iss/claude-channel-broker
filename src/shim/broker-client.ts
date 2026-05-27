import net from 'node:net';
import { encodeMessage, parseLine, WIRE_VERSION } from '../broker/wire.js';
import type {
  BrokerToShimMessage,
  ShimToBrokerMessage,
  ShimToolCallMessage,
} from '../broker/wire.js';
import { correlationId } from '../lib/ids.js';

export interface BrokerClientOptions {
  socketPath: string;
  /** Initial backoff in ms; doubles up to maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Max buffered outbound tool-call messages while disconnected. */
  outboundBufferLimit?: number;
  /** Called whenever the broker pushes a message. */
  onMessage: (msg: BrokerToShimMessage) => void | Promise<void>;
  /** Called on reconnection (after a previous disconnect). */
  onReconnect?: () => void | Promise<void>;
  /** Called on every disconnect. */
  onDisconnect?: (reason: string) => void;
}

interface PendingToolCall {
  message: ShimToolCallMessage;
  resolve: (msg: { result?: unknown; error?: string }) => void;
  reject: (err: Error) => void;
}

/**
 * Reconnecting line-delimited JSON client to the broker's unix socket.
 *
 * Outbound messages: register/reconnect/heartbeat/toolCall.
 * Inbound: registered/dispatch/cancel/comment/toolResult/shutdown/error.
 */
export class BrokerClient {
  private readonly opts: Required<
    Omit<BrokerClientOptions, 'onReconnect' | 'onDisconnect'>
  > &
    Pick<BrokerClientOptions, 'onReconnect' | 'onDisconnect'>;

  private socket: net.Socket | null = null;
  private buffer = '';
  private backoff: number;
  private connected = false;
  private closing = false;
  private hasEverConnected = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly pending = new Map<string, PendingToolCall>();
  private readonly outboundQueue: ShimToBrokerMessage[] = [];
  /** Resolver invoked when the broker acknowledges register/reconnect. */
  private registeredResolvers: Array<() => void> = [];
  /** Set by register/reconnect — used so we can issue reconnect on re-handshake. */
  private sessionId: string | null = null;
  private label: string | null = null;
  private pid: number | null = null;

  constructor(opts: BrokerClientOptions) {
    this.opts = {
      socketPath: opts.socketPath,
      backoffMs: opts.backoffMs ?? 200,
      maxBackoffMs: opts.maxBackoffMs ?? 5_000,
      outboundBufferLimit: opts.outboundBufferLimit ?? 100,
      onMessage: opts.onMessage,
      onReconnect: opts.onReconnect,
      onDisconnect: opts.onDisconnect,
    };
    this.backoff = this.opts.backoffMs;
  }

  /** Connect and send the initial register message. */
  async register(input: {
    sessionId: string;
    label?: string | null;
    pid?: number | null;
  }): Promise<void> {
    this.sessionId = input.sessionId;
    this.label = input.label ?? null;
    this.pid = input.pid ?? null;
    await this.connect();
    const ack = new Promise<void>((resolve) =>
      this.registeredResolvers.push(resolve),
    );
    this.send({
      v: WIRE_VERSION,
      type: 'register',
      sessionId: input.sessionId,
      label: input.label,
      pid: input.pid ?? undefined,
    });
    await ack;
  }

  /** Send a tool call, awaiting the broker's toolResult. */
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<{ result?: unknown; error?: string }> {
    const id = correlationId();
    const message: ShimToolCallMessage = {
      v: WIRE_VERSION,
      type: 'toolCall',
      id,
      name,
      args,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tool call ${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        message,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.send(message);
    });
  }

  /** Close the socket and stop reconnecting. */
  close(): void {
    this.closing = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
    for (const p of this.pending.values()) {
      p.reject(new Error('client closed'));
    }
    this.pending.clear();
  }

  private async connect(): Promise<void> {
    if (this.connected || this.closing) return;
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.opts.socketPath);
      socket.setEncoding('utf8');
      socket.once('connect', () => {
        this.socket = socket;
        this.connected = true;
        this.backoff = this.opts.backoffMs;
        const isReconnect = this.hasEverConnected;
        this.hasEverConnected = true;
        this.scheduleHeartbeat();
        this.flushQueue();
        if (isReconnect && this.opts.onReconnect) {
          void this.opts.onReconnect();
        }
        resolve();
      });
      socket.on('data', (chunk: string) => this.onData(chunk));
      socket.on('close', () => {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.connected = false;
        this.socket = null;
        if (this.opts.onDisconnect) this.opts.onDisconnect('socket_closed');
        if (!this.closing) this.scheduleReconnect();
      });
      socket.on('error', (err) => {
        if (!this.connected) {
          // Initial connect failed; back off and retry.
          if (!this.closing) {
            this.scheduleReconnect();
          }
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    setTimeout(() => {
      if (this.closing) return;
      void this.reconnect().catch(() => {
        this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
        this.scheduleReconnect();
      });
    }, this.backoff);
  }

  private async reconnect(): Promise<void> {
    if (!this.sessionId) return;
    await this.connect();
    const ack = new Promise<void>((resolve) =>
      this.registeredResolvers.push(resolve),
    );
    const inflight = [...this.pending.values()].map((p) => p.message.id);
    this.send({
      v: WIRE_VERSION,
      type: 'reconnect',
      sessionId: this.sessionId,
      inFlightJobIds: inflight,
    });
    await ack;
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.send({ v: WIRE_VERSION, type: 'heartbeat' });
      }
    }, 10_000);
    this.heartbeatTimer.unref?.();
  }

  private send(msg: ShimToBrokerMessage): void {
    if (this.connected && this.socket) {
      this.socket.write(encodeMessage(msg));
      return;
    }
    // Queue tool calls only; drop heartbeats. Drop oldest if buffer full.
    if (msg.type === 'toolCall') {
      this.outboundQueue.push(msg);
      while (this.outboundQueue.length > this.opts.outboundBufferLimit) {
        const dropped = this.outboundQueue.shift();
        if (dropped && dropped.type === 'toolCall') {
          const pending = this.pending.get(dropped.id);
          if (pending) {
            pending.reject(new Error('outbound buffer overflow'));
            this.pending.delete(dropped.id);
          }
        }
      }
    }
  }

  private flushQueue(): void {
    if (!this.connected || !this.socket) return;
    while (this.outboundQueue.length > 0) {
      const msg = this.outboundQueue.shift();
      if (msg) this.socket.write(encodeMessage(msg));
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: BrokerToShimMessage;
      try {
        msg = parseLine<BrokerToShimMessage>(line);
      } catch {
        continue;
      }
      if (msg.type === 'toolResult') {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve({ result: msg.result, error: msg.error });
        }
        continue;
      }
      if (msg.type === 'registered') {
        const resolvers = this.registeredResolvers.splice(0);
        for (const r of resolvers) r();
      }
      void this.opts.onMessage(msg);
    }
  }
}
