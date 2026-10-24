import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueuePort, JobPayload } from './index';
import { Queue } from 'bullmq';

@Injectable()
export class BullMQQueueAdapter implements QueuePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMQQueueAdapter.name);
  private queue?: Queue;
  private isRedisConnected = false;
  private inMemoryJobs = new Map<string, { payload: JobPayload; status: string; progress: number }>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    try {
      this.queue = new Queue('srs-jobs', {
        connection: {
          url: redisUrl,
          maxRetriesPerRequest: null,
          connectTimeout: 2000,
        },
      });
      // Test ping
      await this.queue.waitUntilReady();
      this.isRedisConnected = true;
      this.logger.log('Connected to Redis BullMQ queue (srs-jobs)');
    } catch (err: any) {
      this.logger.warn(`Redis queue connection failed (${err.message}). Using in-memory job queue fallback.`);
      this.isRedisConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
    }
  }

  async enqueue(payload: JobPayload, options?: { priority?: number; delay?: number }): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.inMemoryJobs.set(jobId, { payload, status: 'queued', progress: 0 });

    if (this.isRedisConnected && this.queue) {
      try {
        const job = await this.queue.add(payload.type, payload, {
          jobId,
          priority: options?.priority,
          delay: options?.delay,
        });
        return job.id ?? jobId;
      } catch (err: any) {
        this.logger.warn(`Failed to push to BullMQ (${err.message}), retaining in-memory job tracking.`);
      }
    }

    this.logger.log(`Enqueued job ${jobId} type=${payload.type} for project=${payload.projectId}`);
    return jobId;
  }

  async getJobStatus(jobId: string): Promise<{ status: string; progress: number }> {
    if (this.isRedisConnected && this.queue) {
      try {
        const job = await this.queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          const progress = typeof job.progress === 'number' ? job.progress : 0;
          return { status: state, progress };
        }
      } catch (err) {
        // Fall back to in-memory lookup
      }
    }

    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      return { status: mem.status, progress: mem.progress };
    }
    return { status: 'unknown', progress: 0 };
  }

  updateInMemoryJob(jobId: string, status: string, progress: number) {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      mem.status = status;
      mem.progress = progress;
    }
  }
}
