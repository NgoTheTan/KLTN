import type { Job } from 'bullmq';

/**
 * ExportProcessor
 *
 * Builds export packages in worker (not API process) to avoid blocking.
 * Supported formats: Markdown, DOCX, CSV, JSON, .puml, SVG/PNG, ZIP (all).
 * Stores result in S3 with TTL; API provides pre-signed download link.
 */
export class ExportProcessor {
  async process(job: Job): Promise<void> {
    const { projectId, exportId, formats } = job.data;

    await job.updateProgress(0);

    // TODO: Load requirements, diagrams, coverage report from DB
    // TODO: Generate each format (markdown, docx via docx library, csv, puml, svg)
    // TODO: Bundle into ZIP
    // TODO: Upload to S3 with expiry
    // TODO: Update export record with s3_key and expires_at

    console.log(`[ExportProcessor] Building export ${exportId} for project ${projectId}, formats: ${formats}`);
    await job.updateProgress(100);
  }
}
