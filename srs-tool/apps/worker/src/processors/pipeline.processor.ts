import * as fs from 'fs';
import * as path from 'path';
import type { Job } from 'bullmq';
import { and, eq, inArray, asc, ne } from 'drizzle-orm';
import {
  S1ParseAndSegment,
  CoverageLedger,
  DecisionRouter,
  DEFAULT_STAGE_THRESHOLDS,
  RequirementCodeAllocator,
  runExtraction,
  runClassification,
  runIssueDetection,
  type DecisionLog,
  type RequirementCandidate,
  type ParseSegmentInput,
  type ChecklistTopic,
} from '@srs-tool/pipeline';
import type { Language, Platform, ProcessingMode } from '@srs-tool/schemas';
import { loadCombinedChecklist } from '@srs-tool/knowledge';
import { schema, type DatabaseInstance } from '@srs-tool/db';

const { documents, segments, requirements, requirementSources, issues, runs, decisionLog, projects } = schema;

/** Requirement statuses produced by the automated stages (safe to regenerate). */
const REGENERABLE_STATUSES = ['candidate', 'classified', 'needs_clarification'];

interface RunContext {
  runId: string;
  projectId: string;
  mode: ProcessingMode;
  router: DecisionRouter;
  platforms: string[];
  outputLanguage: Language;
}

/**
 * PipelineProcessor
 *
 * Orchestrates the 8-stage pipeline for a given run.
 * Each stage is an independent step reading its input from and writing its result to
 * PostgreSQL, so it can resume from any stage (`fromStage` in the job payload).
 *
 * Implemented: S1 (parse & segment), S2 (extract), S3 (classify & tag), S4 (issues).
 * Progress is published via BullMQ job progress (→ SSE to frontend).
 */
export class PipelineProcessor {
  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const { runId, projectId, mode, fromStage = 1 } = job.data as {
      runId: string;
      projectId: string;
      mode?: ProcessingMode;
      fromStage?: number;
    };

    if (!this.db) throw new Error('PipelineProcessor requires a database connection (DATABASE_URL)');
    const db = this.db;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const router = new DecisionRouter({
      mode: mode ?? 'standard',
      stageThresholds: { ...DEFAULT_STAGE_THRESHOLDS },
      onLog: (entry) => this.logDecision(db, entry),
    });

    const ctx: RunContext = {
      runId,
      projectId,
      mode: mode ?? 'standard',
      router,
      platforms: project.platforms,
      outputLanguage: (project.outputLanguage as Language) ?? 'vi',
    };

    await this.setRun(db, runId, { status: 'running', progress: 0 });
    await job.updateProgress(0);

    try {
      if (fromStage <= 1) {
        await this.runS1(db, ctx, job);
        await this.advance(db, job, runId, 12);
      }
      if (fromStage <= 2) {
        await this.runS2(db, ctx, job);
        await this.advance(db, job, runId, 25);
      }
      if (fromStage <= 3) {
        await this.runS3(db, ctx, job);
        await this.advance(db, job, runId, 38);
      }
      if (fromStage <= 4) {
        await this.runS4(db, ctx, job);
        await this.advance(db, job, runId, 50);
      }
      // S5 is interactive — waits for user answers (job pauses here if questions exist)
      if (fromStage <= 6) {
        await this.runS6(job);
        await this.advance(db, job, runId, 63);
      }
      if (fromStage <= 7) {
        await this.runS7(job);
        await this.advance(db, job, runId, 75);
      }
      if (fromStage <= 8) {
        await this.runS8(job);
        await this.advance(db, job, runId, 100);
      }
      await this.setRun(db, runId, { status: 'succeeded', progress: 100 });
    } catch (err) {
      await this.setRun(db, runId, { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  // S1: Parse & segment

  private async runS1(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S1] Parse and segment - job ${job.id}`);

    // Re-running from S1 regenerates automated outputs. Approved/user-edited requirements are kept.
    await db.delete(requirements).where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, REGENERABLE_STATUSES)));
    await db.delete(segments).where(eq(segments.projectId, ctx.projectId));

    const docs = await db.select().from(documents).where(eq(documents.projectId, ctx.projectId)).orderBy(asc(documents.createdAt));
    if (docs.length === 0) throw new Error('Project has no documents to process');

    const ledger = new CoverageLedger();
    const s1 = new S1ParseAndSegment(ledger);
    let total = 0;
    const skipped: string[] = [];

    for (const doc of docs) {
      const contentType = this.resolveContentType(doc);
      if (!contentType) {
        skipped.push(doc.filename ?? doc.id);
        continue;
      }
      const content = await this.readDocument(doc.s3Key);
      const { segments: parsed } = await s1.process({ documentId: doc.id, content, contentType });
      if (parsed.length === 0) continue;

      await db.insert(segments).values(
        parsed.map((s) => ({
          id: s.id,
          documentId: doc.id,
          projectId: ctx.projectId,
          ordinal: s.ordinal,
          text: s.text,
          locator: s.locator,
          language: s.language,
          coverageStatus: 'unmapped',
          resolvedBy: s.resolved_by ?? 'rule',
        })),
      );
      total += parsed.length;
    }

    if (skipped.length > 0) {
      console.warn(`[S1] Skipped unsupported documents (PDF/DOCX parsing not available yet): ${skipped.join(', ')}`);
    }
    if (total === 0) throw new Error('No readable text segments found in project documents');
    console.log(`[S1] Registered ${total} segments`);
  }

  // S2: Extract candidates

  private async runS2(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S2] Extract candidates - job ${job.id}`);

    // Idempotent restart: drop previous automated requirements and reset coverage
    await db.delete(requirements).where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, REGENERABLE_STATUSES)));
    await db.update(segments).set({ coverageStatus: 'unmapped', resolvedBy: 'rule' }).where(eq(segments.projectId, ctx.projectId));

    const rows = await db.select().from(segments).where(eq(segments.projectId, ctx.projectId)).orderBy(asc(segments.documentId), asc(segments.ordinal));
    const results = await runExtraction(
      rows.map((r) => ({ id: r.id, text: r.text, language: r.language as Language })),
      { runId: ctx.runId, router: ctx.router },
    );

    const stats = { mapped: 0, not_requirement: 0, unresolved: 0, candidates: 0 };

    for (const res of results) {
      const keep = res.candidates.length > 0;
      const confidentSegment = res.status === 'decided' && res.verdict !== 'unclear';

      if (keep) {
        for (const cand of res.candidates) {
          const lowConfidence = cand.confidence < 0.8;
          const [row] = await db
            .insert(requirements)
            .values({
              projectId: ctx.projectId,
              code: `TMP-${cand.id.slice(0, 8).toUpperCase()}`, // final code assigned in S3
              type: 'functional',
              platforms: ['shared'],
              earsPattern: 'ubiquitous',
              statement: cand.text,
              statementOriginal: cand.text_original,
              language: cand.language,
              status: lowConfidence ? 'needs_clarification' : 'candidate',
              resolvedBy: 'rule',
              confidence: cand.confidence,
            })
            .returning({ id: requirements.id });
          await db.insert(requirementSources).values({ requirementId: row!.id, segmentId: res.segmentId, quote: cand.text_original });
          stats.candidates++;
        }
        await db.update(segments).set({ coverageStatus: 'mapped', resolvedBy: 'rule' }).where(eq(segments.id, res.segmentId));
        stats.mapped++;
      } else if (res.verdict === 'not_requirement' && confidentSegment) {
        await db.update(segments).set({ coverageStatus: 'not_requirement', resolvedBy: 'rule' }).where(eq(segments.id, res.segmentId));
        stats.not_requirement++;
      } else {
        // Hinted but undecided (eco: no LLM) → surface instead of silently dropping
        await db.update(segments).set({ coverageStatus: 'unresolved' }).where(eq(segments.id, res.segmentId));
        stats.unresolved++;
      }
    }

    console.log(`[S2] ${JSON.stringify(stats)}`);
  }

  // S3: Classify & tag

  private async runS3(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S3] Classify and tag - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, REGENERABLE_STATUSES)))
      .orderBy(asc(requirements.createdAt));
    if (rows.length === 0) return;

    // Seed allocator with codes already used (approved / previously classified), skipping temporary ones
    const existing = await db
      .select({ code: requirements.code })
      .from(requirements)
      .where(and(eq(requirements.projectId, ctx.projectId), ne(requirements.status, 'rejected')));
    const allocator = new RequirementCodeAllocator(existing.map((e) => e.code).filter((c) => !c.startsWith('TMP-')));

    const candidates: RequirementCandidate[] = rows.map((r) => ({
      id: r.id,
      segment_id: '',
      text: r.statementOriginal,
      text_original: r.statementOriginal,
      language: r.language as Language,
      confidence: r.confidence,
      tier: 0,
    }));

    const classified = await runClassification(candidates, { runId: ctx.runId, router: ctx.router });
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const item of classified) {
      const row = byId.get(item.candidate.id)!;
      const platforms = this.restrictPlatforms(item.classification.platforms, ctx.platforms);
      const code = row.code.startsWith('TMP-')
        ? allocator.next(item.classification.type, platforms, row.statementOriginal)
        : row.code;
      const decided = item.status === 'decided';

      await db
        .update(requirements)
        .set({
          code,
          type: item.classification.type,
          platforms,
          isAsr: item.classification.is_asr,
          status: decided && row.status !== 'needs_clarification' ? 'classified' : 'needs_clarification',
          confidence: Math.min(row.confidence, item.confidence),
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, row.id));
    }
    console.log(`[S3] Classified ${classified.length} requirements`);
  }

  // S4: Issue detection

  private async runS4(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S4] Issue detection - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, [...REGENERABLE_STATUSES, 'normalized'])));

    // Re-run: clear previously generated open issues of the project
    await db.delete(issues).where(and(eq(issues.projectId, ctx.projectId), eq(issues.status, 'open')));
    if (rows.length === 0) return;

    const sources = await db
      .select({ requirementId: requirementSources.requirementId, segmentId: requirementSources.segmentId })
      .from(requirementSources)
      .where(inArray(requirementSources.requirementId, rows.map((r) => r.id)));
    const segmentOf = new Map(sources.map((s) => [s.requirementId, s.segmentId]));

    let checklist: ChecklistTopic[] = [];
    try {
      let fn: any = typeof loadCombinedChecklist === 'function' ? loadCombinedChecklist : null;
      if (!fn) {
        try {
          fn = (require('@srs-tool/knowledge') as any)?.loadCombinedChecklist;
        } catch {}
      }
      if (!fn) {
        try {
          // Fallback when executed under tsx where tsconfig paths alias to .d.ts
          fn = (require('../../../packages/knowledge/dist/index.js') as any)?.loadCombinedChecklist;
        } catch {}
      }
      if (typeof fn === 'function') {
        checklist = fn(ctx.platforms) as ChecklistTopic[];
      }
    } catch (err) {
      console.warn(`[S4] Checklist unavailable: ${err instanceof Error ? err.message : err}`);
    }

    const result = runIssueDetection(
      rows.map((r) => ({
        id: r.id,
        text: r.statementOriginal,
        language: r.language as Language,
        platforms: r.platforms as Platform[],
      })),
      { checklist, outputLanguage: ctx.outputLanguage },
    );

    const issueRows: Array<typeof issues.$inferInsert> = [];
    const ruleIdsByReq = new Map<string, string[]>();
    const note = (reqId: string, ruleId: string) => ruleIdsByReq.set(reqId, [...(ruleIdsByReq.get(reqId) ?? []), ruleId]);

    for (const pr of result.perRequirement) {
      for (const i of pr.issues) {
        issueRows.push({
          projectId: ctx.projectId,
          requirementId: pr.candidateId,
          segmentId: segmentOf.get(pr.candidateId) ?? null,
          kind: i.kind,
          ruleId: i.rule_id,
          severity: i.severity,
          reason: i.message,
        });
        note(pr.candidateId, i.rule_id);
      }
    }
    for (const c of result.conflicts) {
      for (const id of [c.id1, c.id2]) {
        issueRows.push({
          projectId: ctx.projectId,
          requirementId: id,
          segmentId: segmentOf.get(id) ?? null,
          kind: 'conflict',
          ruleId: 'CONFLICT-NUM',
          severity: 'error',
          reason: c.message,
        });
        note(id, 'CONFLICT-NUM');
      }
    }
    for (const g of result.gaps) {
      issueRows.push({
        projectId: ctx.projectId,
        requirementId: null,
        segmentId: null,
        kind: 'missing',
        ruleId: `CHECKLIST-${g.checklist_id}`,
        severity: g.level === 'required' ? 'warning' : 'info',
        reason: `${g.message} — ${g.question}`,
      });
    }

    if (issueRows.length > 0) await db.insert(issues).values(issueRows);

    for (const pr of result.perRequirement) {
      const conflictPenalty = result.conflicts.some((c) => c.id1 === pr.candidateId || c.id2 === pr.candidateId) ? 20 : 0;
      await db
        .update(requirements)
        .set({
          qualityScore: Math.max(0, pr.qualityScore - conflictPenalty),
          issues: ruleIdsByReq.get(pr.candidateId) ?? [],
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, pr.candidateId));
    }

    console.log(`[S4] ${issueRows.length} issues (conflicts=${result.conflicts.length}, checklist gaps=${result.gaps.length})`);
  }

  // S6-S8: not implemented yet (steps 3+ of the roadmap)

  private async runS6(job: Job) {
    console.log(`[S6] Normalize EARS - job ${job.id}`);
  }

  private async runS7(job: Job) {
    console.log(`[S7] Merge and reduce - job ${job.id}`);
  }

  private async runS8(job: Job) {
    console.log(`[S8] Coverage check - job ${job.id}`);
  }

  // Helpers

  private resolveContentType(doc: typeof documents.$inferSelect): ParseSegmentInput['contentType'] | null {
    const mime = (doc.mimeType ?? '').toLowerCase();
    const name = (doc.filename ?? '').toLowerCase();
    if (doc.kind === 'email' || mime.includes('message/rfc822') || name.endsWith('.eml')) return 'message/rfc822';
    if (mime.includes('pdf') || name.endsWith('.pdf')) return null;
    if (mime.includes('wordprocessingml') || name.endsWith('.docx')) return null;
    if (mime.includes('markdown') || name.endsWith('.md')) return 'text/markdown';
    return 'text/plain';
  }

  private async readDocument(s3Key: string): Promise<string> {
    const baseDir = path.resolve(process.env['UPLOAD_DIR'] ?? path.join(process.cwd(), '.uploads'));
    const filePath = path.resolve(baseDir, s3Key);
    if (!filePath.startsWith(baseDir + path.sep)) throw new Error(`Invalid document key: ${s3Key}`);
    return fs.promises.readFile(filePath, 'utf-8');
  }

  /** Keep only platforms the project targets; fall back to the single project platform or shared. */
  private restrictPlatforms(detected: Platform[], projectPlatforms: string[]): Platform[] {
    const allowed = detected.filter((p) => p === 'shared' || projectPlatforms.includes(p));
    if (allowed.length > 0) return allowed;
    return projectPlatforms.length === 1 ? [projectPlatforms[0] as Platform] : ['shared'];
  }

  private async advance(db: DatabaseInstance, job: Job, runId: string, progress: number): Promise<void> {
    await job.updateProgress(progress);
    await this.setRun(db, runId, { progress });
  }

  private async setRun(
    db: DatabaseInstance,
    runId: string,
    patch: Partial<Pick<typeof runs.$inferInsert, 'status' | 'progress' | 'errorMessage'>>,
  ): Promise<void> {
    try {
      await db.update(runs).set({ ...patch, updatedAt: new Date() }).where(eq(runs.id, runId));
    } catch (err) {
      console.warn(`[Run ${runId}] could not update run row: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async logDecision(db: DatabaseInstance, entry: Omit<DecisionLog, 'id' | 'decidedAt'>): Promise<void> {
    try {
      await db.insert(decisionLog).values({
        runId: entry.runId,
        stage: entry.stage,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        tier: entry.tier,
        confidence: entry.confidence,
        version: entry.version,
        status: entry.status,
      });
    } catch (err) {
      // Decision logging must never fail the pipeline (e.g. run row missing in dev)
      console.warn(`[decision_log] ${err instanceof Error ? err.message : err}`);
    }
  }
}
