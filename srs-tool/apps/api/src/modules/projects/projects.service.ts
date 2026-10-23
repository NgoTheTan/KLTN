import { Injectable } from '@nestjs/common';

/**
 * ProjectsService
 *
 * Business logic for project management.
 * Each method will delegate to repositories (Drizzle) and queue ports.
 * Module boundary: only interacts with other modules via their exported services,
 * never accesses other modules' DB tables directly.
 */
@Injectable()
export class ProjectsService {
  async create(data: { name: string; platforms: string[]; output_language: string }) {
    // TODO: Insert into projects table, return project with ID
    return { id: crypto.randomUUID(), ...data, created_at: new Date().toISOString() };
  }

  async findAll() {
    // TODO: Query projects for current user (filtered by owner_id via RLS)
    return [];
  }

  async findOne(id: string) {
    // TODO: Query project by ID
    return { id };
  }

  async getCoverage(projectId: string) {
    // TODO: Query coverage ledger via SQL
    return { total_segments: 0, mapped: 0, not_requirement: 0, unresolved: 0, unmapped: 0, coverage_pct: 0 };
  }

  async getChecklist(projectId: string) {
    // TODO: Load platform profile YAMLs for project's platforms
    // TODO: Compare checklist items against project requirements
    return [];
  }

  async updateChecklistItem(projectId: string, itemId: string, data: { not_applicable: boolean; reason?: string }) {
    // TODO: Update issue record with not_applicable status
    return { projectId, itemId, ...data };
  }

  async uploadDocument(projectId: string, data: unknown) {
    // TODO: Validate file type/size, upload to S3, create Document record
    return { document_id: crypto.randomUUID() };
  }

  async startRun(projectId: string, options: { mode?: string; from_stage?: number }) {
    // TODO: Create Run record, enqueue pipeline job to BullMQ
    return { run_id: crypto.randomUUID(), status: 'queued' };
  }

  async synthesizeArchitecture(projectId: string) {
    // TODO: Enqueue architecture synthesis job (no LLM by default, use tactics catalog)
    return { job_id: crypto.randomUUID(), status: 'queued' };
  }

  async createExport(projectId: string, formats: string[]) {
    // TODO: Enqueue export job, return pre-signed download URL when ready
    return { export_id: crypto.randomUUID(), status: 'processing' };
  }
}
