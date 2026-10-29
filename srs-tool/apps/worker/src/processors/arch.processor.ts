import type { Job } from 'bullmq';
import { generateDiagram } from '@srs-tool/plantuml-gen';

/**
 * ArchProcessor
 *
 * Synthesizes the architecture model from:
 * 1. Reference architecture template (by platform)
 * 2. Tactics catalog (from ASR quality attributes)
 * 3. Feature detector (keywords → add components)
 *
 * Does NOT call LLM by default.
 * LLM enrichment is an explicit opt-in ("Enrich with LLM" button).
 */
import type { DatabaseInstance } from '@srs-tool/db';

export class ArchProcessor {
  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const { projectId, runId } = job.data;

    await job.updateProgress(0);

    // 1. Load ASRs from DB
    // 2. Load reference architecture template for platform
    // 3. Apply tactics from catalog based on ASR quality attributes
    // 4. Apply feature detector (auth, payment, notifications, etc.)
    // 5. Generate PlantUML for Context and Container views
    // 6. Save model + diagrams to DB

    console.log(`[ArchProcessor] Synthesizing architecture for project ${projectId}`);
    await job.updateProgress(100);
  }
}
