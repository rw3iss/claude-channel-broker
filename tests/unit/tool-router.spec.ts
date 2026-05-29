import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchTool } from '../../src/broker/tool-router.js';
import type { JobService } from '../../src/broker/job-service.js';

interface Call {
  method: string;
  jobId: string;
  arg?: unknown;
}

function fakeService(): { service: JobService; calls: Call[] } {
  const calls: Call[] = [];
  const job = (status: string) => ({ status });
  const service = {
    async complete(jobId: string, result: unknown) {
      calls.push({ method: 'complete', jobId, arg: result });
      return job('completed');
    },
    async fail(jobId: string, error: string) {
      calls.push({ method: 'fail', jobId, arg: error });
      return job('failed');
    },
    async noteProgress(jobId: string, note: string) {
      calls.push({ method: 'noteProgress', jobId, arg: note });
      return job('in_progress');
    },
    async ack(jobId: string) {
      calls.push({ method: 'ack', jobId });
      return job('in_progress');
    },
  } as unknown as JobService;
  return { service, calls };
}

const ctx = { sessionId: 's1' };

describe('dispatchTool', () => {
  let f: ReturnType<typeof fakeService>;
  beforeEach(() => {
    f = fakeService();
  });

  it('routes complete_job and returns { ok, status }', async () => {
    const r = await dispatchTool(f.service, 'complete_job', {
      job_id: 'j1',
      result: { x: 1 },
    }, ctx);
    expect(r).toEqual({ ok: true, status: 'completed' });
    expect(f.calls).toEqual([{ method: 'complete', jobId: 'j1', arg: { x: 1 } }]);
  });

  it('routes fail_job, passing the error string through', async () => {
    const r = await dispatchTool(f.service, 'fail_job', {
      job_id: 'j2',
      error: 'boom',
    }, ctx);
    expect(r.status).toBe('failed');
    expect(f.calls[0]).toEqual({ method: 'fail', jobId: 'j2', arg: 'boom' });
  });

  it('coerces a non-string fail error via JSON.stringify', async () => {
    await dispatchTool(f.service, 'fail_job', {
      job_id: 'j3',
      error: { code: 42 },
    }, ctx);
    expect(f.calls[0].arg).toBe('{"code":42}');
  });

  it('routes note_progress, coercing non-string notes', async () => {
    await dispatchTool(f.service, 'note_progress', {
      job_id: 'j4',
      note: { step: 1 },
    }, ctx);
    expect(f.calls[0]).toEqual({
      method: 'noteProgress',
      jobId: 'j4',
      arg: '{"step":1}',
    });
  });

  it('routes ack_job', async () => {
    const r = await dispatchTool(f.service, 'ack_job', { job_id: 'j5' }, ctx);
    expect(r.status).toBe('in_progress');
    expect(f.calls[0].method).toBe('ack');
  });

  it('throws on unknown tool name', async () => {
    await expect(
      dispatchTool(f.service, 'nope', { job_id: 'j6' }, ctx),
    ).rejects.toThrow(/unknown tool/);
  });

  it('throws when job_id is missing or non-string', async () => {
    await expect(
      dispatchTool(f.service, 'complete_job', {}, ctx),
    ).rejects.toThrow(/job_id is required/);
    await expect(
      dispatchTool(f.service, 'complete_job', { job_id: 123 }, ctx),
    ).rejects.toThrow(/job_id is required/);
  });
});
