import { Worker, Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { PipelineProcessor } from './processors/pipeline.processor.js';
import { ArchProcessor } from './processors/arch.processor.js';
import { ExportProcessor } from './processors/export.processor.js';

const connection = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'srs-jobs';

// Register processors

const pipelineProcessor = new PipelineProcessor();
const archProcessor = new ArchProcessor();
const exportProcessor = new ExportProcessor();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[Worker] Processing job ${job.id} type=${job.data.type}`);

    switch (job.data.type) {
      case 'pipeline':
        return pipelineProcessor.process(job);
      case 'architecture':
        return archProcessor.process(job);
      case 'export':
        return exportProcessor.process(job);
      default:
        throw new Error(`Unknown job type: ${job.data.type}`);
    }
  },
  {
    connection,
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '4'),
    limiter: {
      max: 10,       // max 10 jobs per duration window
      duration: 1000, // per second
    },
  },
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

console.log(`[Worker] Started. Listening on queue: ${QUEUE_NAME}`);
