import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueuePort, JobPayload } from './index';
import { Queue, QueueEvents } from 'bullmq';

@Injectable()
export class BullMQQueueAdapter implements QueuePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMQQueueAdapter.name);
  private queue?: Queue;
  private queueEvents?: QueueEvents;
  private isRedisConnected = false;
  private inMemoryJobs = new Map<string, { payload: JobPayload; status: string; progress: number }>();

  private progressListeners: Array<(event: { jobId: string; progress: number; data?: any }) => void> = [];
  private completedListeners: Array<(event: { jobId: string; returnvalue?: any }) => void> = [];
  private failedListeners: Array<(event: { jobId: string; failedReason: string }) => void> = [];

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

      // Initialize QueueEvents to forward BullMQ worker progress/completed/failed events
      this.queueEvents = new QueueEvents('srs-jobs', {
        connection: {
          url: redisUrl,
          maxRetriesPerRequest: null,
        },
      });

      this.queueEvents.on('progress', ({ jobId, data }) => {
        const progressNum = typeof data === 'number' ? data : (data as any)?.progress ?? 0;
        this.updateInMemoryJob(jobId, 'running', progressNum);
        for (const listener of this.progressListeners) {
          listener({ jobId, progress: progressNum, data });
        }
      });

      this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
        this.updateInMemoryJob(jobId, 'completed', 100);
        for (const listener of this.completedListeners) {
          listener({ jobId, returnvalue });
        }
      });

      this.queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.updateInMemoryJob(jobId, 'failed', 0);
        for (const listener of this.failedListeners) {
          listener({ jobId, failedReason });
        }
      });

      this.logger.log('Connected to Redis BullMQ queue and QueueEvents (srs-jobs)');
    } catch (err: any) {
      this.logger.warn(`Redis queue connection failed (${err.message}). Using in-memory job queue fallback.`);
      this.isRedisConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.queue) {
      await this.queue.close();
    }
  }

  async enqueue(payload: JobPayload, options?: { priority?: number; delay?: number }): Promise<string> {
    // Crucial: use payload.runId as BullMQ jobId so status and events correspond 1-to-1 with runId
    const jobId = payload.runId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

  onProgress(callback: (event: { jobId: string; progress: number; data?: any }) => void) {
    this.progressListeners.push(callback);
  }

  onCompleted(callback: (event: { jobId: string; returnvalue?: any }) => void) {
    this.completedListeners.push(callback);
  }

  onFailed(callback: (event: { jobId: string; failedReason: string }) => void) {
    this.failedListeners.push(callback);
  }

  updateInMemoryJob(jobId: string, status: string, progress: number) {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      mem.status = status;
      mem.progress = progress;
    }
  }
}
