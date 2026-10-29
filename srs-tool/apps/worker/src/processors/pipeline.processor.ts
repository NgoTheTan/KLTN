import type { Job } from 'bullmq';
import {
  S1ParseAndSegment,
  S2ExtractCandidates,
  S3ClassifyAndTag,
  S4IssueDetector,
  S5QuestionBuilder,
  S6Normalizer,
  S7MergeAndReduce,
  S8CoverageChecker,
  CoverageLedger,
  DecisionRouter,
} from '@srs-tool/pipeline';

/**
 * PipelineProcessor
 *
 * Orchestrates the 8-stage pipeline for a given run.
 * Each stage is an independent step with its own result stored in PostgreSQL.
 * Can resume from any stage (fromStage field in job payload).
 *
 * Progress is published via BullMQ job progress (→ SSE to frontend).
 */
import type { DatabaseInstance } from '@srs-tool/db';

export class PipelineProcessor {
  private ledger = new CoverageLedger();

  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const { runId, projectId, mode, fromStage = 1 } = job.data;

    const router = new DecisionRouter({
      mode: mode ?? 'standard',
      stageThresholds: {
        extract: { tier0AcceptMin: 0.90, tier1AcceptMin: 0.85 },
        classify: { tier0AcceptMin: 0.80, tier1AcceptMin: 0.75 },
        normalize: { tier0AcceptMin: 0.85, tier1AcceptMin: 0.80 },
        merge: { tier0AcceptMin: 0.92, tier1AcceptMin: 0.85 },
        coverage: { tier0AcceptMin: 1.0, tier1AcceptMin: 0.90 },
      },
    });

    await job.updateProgress(0);

    if (fromStage <= 1) {
      await this.runS1(job, router);
      await job.updateProgress(12);
    }
    if (fromStage <= 2) {
      await this.runS2(job, router);
      await job.updateProgress(25);
    }
    if (fromStage <= 3) {
      await this.runS3(job, router);
      await job.updateProgress(38);
    }
    if (fromStage <= 4) {
      await this.runS4(job, router);
      await job.updateProgress(50);
    }
    // S5 is interactive — waits for user answers (job pauses here if questions exist)
    if (fromStage <= 6) {
      await this.runS6(job, router);
      await job.updateProgress(63);
    }
    if (fromStage <= 7) {
      await this.runS7(job, router);
      await job.updateProgress(75);
    }
    if (fromStage <= 8) {
      await this.runS8(job, router);
      await job.updateProgress(100);
    }
  }

  private async runS1(job: Job, router: DecisionRouter) {
    // TODO: Load document content from S3
    // TODO: Run S1ParseAndSegment, store segments in DB
    console.log(`[S1] Parse and segment - job ${job.id}`);
  }

  private async runS2(job: Job, router: DecisionRouter) {
    // TODO: Load segments from DB, run S2ExtractCandidates per segment
    // TODO: Batch LLM calls for low-confidence segments (tier 2)
    console.log(`[S2] Extract candidates - job ${job.id}`);
  }

  private async runS3(job: Job, router: DecisionRouter) {
    console.log(`[S3] Classify and tag - job ${job.id}`);
  }

  private async runS4(job: Job, router: DecisionRouter) {
    console.log(`[S4] Issue detection - job ${job.id}`);
  }

  private async runS6(job: Job, router: DecisionRouter) {
    console.log(`[S6] Normalize EARS - job ${job.id}`);
  }

  private async runS7(job: Job, router: DecisionRouter) {
    console.log(`[S7] Merge and reduce - job ${job.id}`);
  }

  private async runS8(job: Job, router: DecisionRouter) {
    console.log(`[S8] Coverage check - job ${job.id}`);
  }
}
