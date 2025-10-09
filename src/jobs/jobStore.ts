import { Job, JobOptions } from './types.js';
import { createId } from '../util/id.js';

export class JobStore {
  private jobs = new Map<string, Job>();

  createJob(url: string, options: JobOptions): Job {
    const id = createId();
    const now = new Date().toISOString();
    const job: Job = {
      id,
      url,
      options,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  updateJob(id: string, patch: Partial<Job>): Job | undefined {
    const cur = this.jobs.get(id);
    if (!cur) return undefined;
    const updated: Job = { ...cur, ...patch, updatedAt: new Date().toISOString() } as Job;
    this.jobs.set(id, updated);
    return updated;
  }
}
