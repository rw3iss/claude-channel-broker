export interface JobDispatcher {
  /**
   * Called by JobService after insert. Returns immediately; dispatcher
   * decides when to actually send.
   */
  notifyPending(sessionId: string, jobId: string): Promise<void>;

  /**
   * Called by JobService after a job reaches a terminal state — lets the
   * dispatcher pick the next pending job on the same session.
   */
  notifyDone(sessionId: string, jobId: string): Promise<void>;

  /**
   * Called when a session attaches. Dispatcher should kick off any
   * pending jobs queued for that session.
   */
  notifySessionAttached(sessionId: string): Promise<void>;

  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The shim-facing surface the dispatcher uses to actually emit messages. */
export interface DispatchSink {
  send(
    sessionId: string,
    message: {
      type: 'dispatch';
      jobId: string;
      content: string;
      meta: Record<string, string>;
    },
  ): Promise<void>;
}
