import * as fs from 'fs';
import * as path from 'path';
import type { Job } from 'bullmq';
import { and, eq, inArray, asc, ne, isNotNull, sql } from 'drizzle-orm';
import {
  S1ParseAndSegment,
  S3ClassifyAndTag,
  CoverageLedger,
  DecisionRouter,
  DEFAULT_STAGE_THRESHOLDS,
  RequirementCodeAllocator,
  runExtraction,
  runClassification,
  runIssueDetection,
  runQuestionBuilding,
  runNormalization,
  runMergeAndReduce,
  runCoverageAndPreservation,
  type DecisionLog,
  type RequirementCandidate,
  type ParseSegmentInput,
  type ChecklistTopic,
  type IssueForQuestion,
} from '@srs-tool/pipeline';
import type { Language, Platform, ProcessingMode, Segment } from '@srs-tool/schemas';
import { loadCombinedChecklist, loadPlatformDefaults } from '@srs-tool/knowledge';
import { schema, type DatabaseInstance } from '@srs-tool/db';
import { resolveUploadDir } from '../utils/storage-dir.js';

const {
  documents,
  segments,
  requirements,
  requirementVersions,
  requirementSources,
  issues,
  questions,
  glossaryTerms,
  runs,
  decisionLog,
  projects,
} = schema;

/** Requirement statuses produced by automated stages (safe to regenerate on full S1/S2 re-run). */
const REGENERABLE_STATUSES = ['candidate', 'classified', 'needs_clarification', 'normalized', 'merged'];

interface RunContext {
  runId: string;
  projectId: string;
  mode: ProcessingMode;
  escalate: boolean;
  router: DecisionRouter;
  platforms: string[];
  outputLanguage: Language;
}

/**
 * PipelineProcessor
 *
 * Orchestrates all 8 stages (S1 -> S8) against PostgreSQL with per-stage checkpoints,
 * cancellation checks (FR-RVW-007), PDF/DOCX binary extraction (FR-ING-001/008),
 * clarification question generation (S5), EARS normalization (S6), safe deduplication (S7),
 * and deterministic information-preservation + Coverage Ledger verification (S8).
 */
export class PipelineProcessor {
  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const {
      runId,
      projectId,
      mode,
      fromStage = 1,
      escalate = false,
    } = job.data as {
      runId: string;
      projectId: string;
      mode?: ProcessingMode;
      fromStage?: number;
      escalate?: boolean;
    };

    if (!this.db) throw new Error('PipelineProcessor requires a database connection (DATABASE_URL)');
    const db = this.db;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const effectiveFromStage = escalate ? Math.max(fromStage, 3) : fromStage;
    const effectiveMode: ProcessingMode = mode ?? 'standard';

    const router = new DecisionRouter({
      mode: effectiveMode,
      stageThresholds: { ...DEFAULT_STAGE_THRESHOLDS },
      onLog: (entry) => this.logDecision(db, entry),
    });

    const ctx: RunContext = {
      runId,
      projectId,
      mode: effectiveMode,
      escalate,
      router,
      platforms: project.platforms,
      outputLanguage: (project.outputLanguage as Language) ?? 'vi',
    };

    await this.setRun(db, runId, { status: 'running', progress: 0, errorMessage: null });
    await job.updateProgress(0);

    try {
      const stages: Array<{ num: number; pct: number; fn: () => Promise<void> }> = [
        { num: 1, pct: 12, fn: () => this.runS1(db, ctx, job) },
        { num: 2, pct: 25, fn: () => this.runS2(db, ctx, job) },
        { num: 3, pct: 38, fn: () => this.runS3(db, ctx, job) },
        { num: 4, pct: 50, fn: () => this.runS4(db, ctx, job) },
        { num: 5, pct: 58, fn: () => this.runS5(db, ctx, job) },
        { num: 6, pct: 72, fn: () => this.runS6(db, ctx, job) },
        { num: 7, pct: 86, fn: () => this.runS7(db, ctx, job) },
        { num: 8, pct: 100, fn: () => this.runS8(db, ctx, job) },
      ];

      for (const stage of stages) {
        if (effectiveFromStage > stage.num) continue;
        if (await this.isRunCancelled(db, runId)) {
          console.log(`[Run ${runId}] Cancelled before S${stage.num}`);
          return;
        }
        await stage.fn();
        await this.advance(db, job, runId, stage.pct);
      }

      // Final status gate: pause in 'waiting_input' if blocking questions or unresolved segments remain
      const pendingBlockingQuestions = await db
        .select({ id: questions.id, severity: issues.severity })
        .from(questions)
        .leftJoin(issues, eq(questions.issueId, issues.id))
        .where(and(eq(questions.projectId, projectId), eq(questions.status, 'pending')));

      const hasBlocking = pendingBlockingQuestions.some((q) => q.severity === 'error');
      const finalStatus = hasBlocking ? 'waiting_input' : 'succeeded';
      await this.setRun(db, runId, { status: finalStatus, progress: 100 });
    } catch (err) {
      await this.setRun(db, runId, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // S1: Parse & segment (preserves user clarification segments where documentId IS NULL)

  private async runS1(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S1] Parse and segment - job ${job.id}`);

    await db
      .delete(requirements)
      .where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, REGENERABLE_STATUSES)));
    await db
      .delete(segments)
      .where(and(eq(segments.projectId, ctx.projectId), isNotNull(segments.documentId)));

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, ctx.projectId))
      .orderBy(asc(documents.createdAt));
    if (docs.length === 0) throw new Error('Project has no documents to process');

    const ledger = new CoverageLedger();
    const s1 = new S1ParseAndSegment(ledger);
    let total = 0;

    for (const doc of docs) {
      const contentType = this.resolveContentType(doc);
      const isBinary =
        contentType === 'application/pdf' ||
        contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const content = await this.readDocument(doc.s3Key, isBinary);
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

    if (total === 0) throw new Error('No readable text segments found in project documents');
    console.log(`[S1] Registered ${total} segments`);
  }

  // S2: Extract candidates

  private async runS2(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S2] Extract candidates - job ${job.id}`);

    await db
      .delete(requirements)
      .where(and(eq(requirements.projectId, ctx.projectId), inArray(requirements.status, REGENERABLE_STATUSES)));
    await db
      .update(segments)
      .set({ coverageStatus: 'unmapped', resolvedBy: 'rule' })
      .where(and(eq(segments.projectId, ctx.projectId), isNotNull(segments.documentId)));

    const rows = await db
      .select()
      .from(segments)
      .where(and(eq(segments.projectId, ctx.projectId), isNotNull(segments.documentId)))
      .orderBy(asc(segments.documentId), asc(segments.ordinal));

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
          const [inserted] = await db
            .insert(requirements)
            .values({
              projectId: ctx.projectId,
              code: `TMP-${cand.id.slice(0, 8).toUpperCase()}`,
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
            .returning();

          await db.insert(requirementSources).values({
            requirementId: inserted!.id,
            segmentId: res.segmentId,
            quote: cand.text_original,
          });

          await db.insert(requirementVersions).values({
            requirementId: inserted!.id,
            version: 1,
            snapshot: inserted as unknown as Record<string, unknown>,
            changedBy: 'pipeline',
            runId: ctx.runId,
          });
          stats.candidates++;
        }
        await db
          .update(segments)
          .set({ coverageStatus: 'mapped', resolvedBy: 'rule' })
          .where(eq(segments.id, res.segmentId));
        stats.mapped++;
      } else if (res.verdict === 'not_requirement' && confidentSegment) {
        await db
          .update(segments)
          .set({ coverageStatus: 'not_requirement', resolvedBy: 'rule' })
          .where(eq(segments.id, res.segmentId));
        stats.not_requirement++;
      } else {
        await db
          .update(segments)
          .set({ coverageStatus: 'unresolved' })
          .where(eq(segments.id, res.segmentId));
        stats.unresolved++;
      }
    }

    console.log(`[S2] ${JSON.stringify(stats)}`);
  }

  // S3: Classify, allocate codes & extract bilingual glossary terms

  private async runS3(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S3] Classify and tag - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.projectId, ctx.projectId),
          inArray(requirements.status, ['candidate', 'classified', 'needs_clarification']),
        ),
      )
      .orderBy(asc(requirements.createdAt));

    if (rows.length > 0) {
      const existing = await db
        .select({ code: requirements.code })
        .from(requirements)
        .where(and(eq(requirements.projectId, ctx.projectId), ne(requirements.status, 'rejected')));
      const allocator = new RequirementCodeAllocator(
        existing.map((e) => e.code).filter((c) => !c.startsWith('TMP-')),
      );

      const candidates: RequirementCandidate[] = rows.map((r) => ({
        id: r.id,
        segment_id: '',
        text: r.statement || r.statementOriginal,
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

    // Extract bilingual glossary terms from source segments (FR-REQ-015)
    const projSegments = await db
      .select({ text: segments.text, language: segments.language })
      .from(segments)
      .where(eq(segments.projectId, ctx.projectId));

    if (projSegments.length > 0) {
      const s3 = new S3ClassifyAndTag();
      const extractedTerms = s3.extractGlossaryCandidates(
        projSegments.map((s) => ({ text: s.text, language: s.language as Language })),
      );
      if (extractedTerms.length > 0) {
        const existingGlossary = await db
          .select()
          .from(glossaryTerms)
          .where(eq(glossaryTerms.projectId, ctx.projectId));
        const existingKeys = new Set(
          existingGlossary.map((g) => `${g.termVi.toLowerCase()}::${g.termEn.toLowerCase()}`),
        );
        const toInsert = extractedTerms.filter(
          (t) => !existingKeys.has(`${t.termVi.toLowerCase()}::${t.termEn.toLowerCase()}`),
        );
        if (toInsert.length > 0) {
          await db.insert(glossaryTerms).values(
            toInsert.map((t) => ({
              projectId: ctx.projectId,
              termVi: t.termVi,
              termEn: t.termEn,
              definition: t.definition,
            })),
          );
        }
      }
    }
  }

  // S4: Issue detection (lint + numeric conflicts + checklist diff respecting not_applicable)

  private async runS4(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S4] Issue detection - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.projectId, ctx.projectId),
          inArray(requirements.status, ['candidate', 'classified', 'needs_clarification', 'normalized']),
        ),
      );

    // Preserve dismissed and not_applicable issues; clear only previously generated open issues
    const nonApplicableRows = await db
      .select({ ruleId: issues.ruleId })
      .from(issues)
      .where(and(eq(issues.projectId, ctx.projectId), eq(issues.status, 'not_applicable')));
    const excludedChecklistIds = new Set(
      nonApplicableRows.map((r) => r.ruleId.replace(/^CHECKLIST[-:]/, '')),
    );

    await db.delete(issues).where(and(eq(issues.projectId, ctx.projectId), eq(issues.status, 'open')));
    if (rows.length === 0) return;

    const sources = await db
      .select({ requirementId: requirementSources.requirementId, segmentId: requirementSources.segmentId })
      .from(requirementSources)
      .where(inArray(requirementSources.requirementId, rows.map((r) => r.id)));
    const segmentOf = new Map(sources.map((s) => [s.requirementId, s.segmentId]));

    let checklist: ChecklistTopic[] = [];
    try {
      const fullChecklist = loadCombinedChecklist(ctx.platforms) as ChecklistTopic[];
      checklist = fullChecklist.filter((item) => !excludedChecklistIds.has(item.id));
    } catch (err) {
      console.warn(`[S4] Checklist unavailable: ${err instanceof Error ? err.message : err}`);
    }

    const result = runIssueDetection(
      rows.map((r) => ({
        id: r.id,
        text: r.statement || r.statementOriginal,
        language: r.language as Language,
        platforms: r.platforms as Platform[],
      })),
      { checklist, outputLanguage: ctx.outputLanguage },
    );

    const issueRows: Array<typeof issues.$inferInsert> = [];
    const ruleIdsByReq = new Map<string, string[]>();
    const note = (reqId: string, ruleId: string) =>
      ruleIdsByReq.set(reqId, [...(ruleIdsByReq.get(reqId) ?? []), ruleId]);

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
      const conflictPenalty = result.conflicts.some(
        (c) => c.id1 === pr.candidateId || c.id2 === pr.candidateId,
      )
        ? 20
        : 0;
      await db
        .update(requirements)
        .set({
          qualityScore: Math.max(0, pr.qualityScore - conflictPenalty),
          issues: ruleIdsByReq.get(pr.candidateId) ?? [],
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, pr.candidateId));
    }

    console.log(
      `[S4] ${issueRows.length} issues (conflicts=${result.conflicts.length}, checklist gaps=${result.gaps.length})`,
    );
  }

  // S5: Build slot-filled clarification questions from open issues

  private async runS5(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S5] Build clarification questions - job ${job.id}`);

    // Remove pending questions from previous runs (answered/skipped questions are preserved)
    await db
      .delete(questions)
      .where(and(eq(questions.projectId, ctx.projectId), eq(questions.status, 'pending')));

    const openIssues = await db
      .select()
      .from(issues)
      .where(and(eq(issues.projectId, ctx.projectId), eq(issues.status, 'open')));
    if (openIssues.length === 0) return;

    const reqRows = await db
      .select({ id: requirements.id, statement: requirements.statement })
      .from(requirements)
      .where(eq(requirements.projectId, ctx.projectId));
    const textByReqId = new Map(reqRows.map((r) => [r.id, r.statement]));

    let platformDefaults: Record<string, string | number | boolean> = {};
    try {
      platformDefaults = loadPlatformDefaults(ctx.platforms);
    } catch {
      // Optional defaults
    }

    const issueInputs: IssueForQuestion[] = openIssues.map((iss) => ({
      issue_id: iss.id,
      rule_id: iss.ruleId,
      kind: iss.kind as IssueForQuestion['kind'],
      severity: iss.severity as IssueForQuestion['severity'],
      message: iss.reason ?? iss.ruleId,
      requirement_text: iss.requirementId ? (textByReqId.get(iss.requirementId) ?? '') : '',
    }));

    const built = runQuestionBuilding(issueInputs, {
      outputLanguage: ctx.outputLanguage,
      platformDefaults,
    });

    if (built.length > 0) {
      await db.insert(questions).values(
        built.map((q) => ({
          id: q.id,
          projectId: ctx.projectId,
          issueId: q.issue_id,
          topicGroup: q.topic_group,
          ruleId: q.rule_id,
          text: q.text,
          options: q.suggested_values ?? [],
          proposedValue: q.proposed_value ?? null,
          status: 'pending',
        })),
      );
    }

    console.log(`[S5] Generated ${built.length} clarification questions`);
  }

  // S6: Normalize statements into EARS + Given/When/Then + immutable version snapshot

  private async runS6(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S6] Normalize EARS - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.projectId, ctx.projectId),
          inArray(requirements.status, ['candidate', 'classified', 'needs_clarification']),
        ),
      );
    if (rows.length === 0) return;

    const openErrors = await db
      .select({ requirementId: issues.requirementId })
      .from(issues)
      .where(
        and(
          eq(issues.projectId, ctx.projectId),
          eq(issues.status, 'open'),
          eq(issues.severity, 'error'),
        ),
      );
    const errorReqIds = new Set(openErrors.map((e) => e.requirementId).filter(Boolean));

    const normalized = await runNormalization(
      rows.map((r) => ({
        id: r.id,
        text: r.statement || r.statementOriginal,
        language: r.language as Language,
      })),
      { runId: ctx.runId, router: ctx.router },
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    let normalizedCount = 0;

    for (const item of normalized) {
      const row = byId.get(item.id);
      if (!row || !item.normalization) continue;

      const norm = item.normalization;
      const nextStatus = errorReqIds.has(row.id) ? 'needs_clarification' : 'normalized';

      const [updated] = await db
        .update(requirements)
        .set({
          statement: norm.statement,
          earsPattern: norm.ears_pattern,
          priority: norm.priority,
          rationale: norm.rationale ?? row.rationale,
          metric: (norm.metric as unknown as Record<string, unknown>) ?? row.metric,
          acceptanceCriteria: norm.acceptance_criteria,
          verificationMethod: norm.verification_method,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, row.id))
        .returning();

      if (updated) {
        await this.appendRequirementVersion(db, updated, 'pipeline', ctx.runId);
        normalizedCount++;
      }
    }

    console.log(`[S6] Normalized ${normalizedCount}/${rows.length} requirements`);
  }

  // S7: Merge duplicates while preserving all requirement_sources links (FR-REQ-009)

  private async runS7(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S7] Merge and reduce - job ${job.id}`);

    const rows = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.projectId, ctx.projectId),
          inArray(requirements.status, ['classified', 'normalized', 'needs_clarification']),
        ),
      );
    if (rows.length < 2) return;

    const mergeResult = await runMergeAndReduce(
      rows.map((r) => ({
        id: r.id,
        text: r.statement,
        language: r.language as Language,
        type: r.type,
        qualityScore: r.qualityScore,
      })),
      { runId: ctx.runId, router: ctx.router },
    );

    let mergedCount = 0;
    for (const group of mergeResult.autoMerges) {
      // Transfer source segment links from duplicates onto the primary requirement
      const dupSources = await db
        .select()
        .from(requirementSources)
        .where(inArray(requirementSources.requirementId, group.duplicateIds));

      for (const src of dupSources) {
        await db
          .insert(requirementSources)
          .values({
            requirementId: group.primaryId,
            segmentId: src.segmentId,
            quote: src.quote,
          })
          .onConflictDoNothing();
      }

      for (const dupId of group.duplicateIds) {
        const [mergedRow] = await db
          .update(requirements)
          .set({
            status: 'merged',
            rationale: `Merged into ${group.primaryId}: ${group.reason}`,
            updatedAt: new Date(),
          })
          .where(eq(requirements.id, dupId))
          .returning();

        if (mergedRow) {
          await this.appendRequirementVersion(db, mergedRow, 'pipeline', ctx.runId);
          mergedCount++;
        }
      }
    }

    // Surface review-band near-duplicates as informational issues for human review
    for (const rev of mergeResult.reviewPairs) {
      await db.insert(issues).values({
        projectId: ctx.projectId,
        requirementId: rev.id1,
        segmentId: null,
        kind: 'ambiguous',
        ruleId: 'MERGE-REVIEW',
        severity: 'info',
        reason: `${rev.reason} (candidate pair with ${rev.id2.slice(0, 8)})`,
      });
    }

    console.log(`[S7] Merged ${mergedCount} duplicate requirements (review=${mergeResult.reviewPairs.length})`);
  }

  // S8: Deterministic information preservation & Coverage Ledger audit (FR-REQ-020, FR-REQ-010)

  private async runS8(db: DatabaseInstance, ctx: RunContext, job: Job): Promise<void> {
    console.log(`[S8] Coverage & preservation check - job ${job.id}`);

    const activeReqs = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.projectId, ctx.projectId),
          inArray(requirements.status, ['classified', 'normalized', 'needs_clarification', 'approved']),
        ),
      );

    const allSegs = await db
      .select()
      .from(segments)
      .where(eq(segments.projectId, ctx.projectId))
      .orderBy(asc(segments.ordinal));

    const mappedSegs: Segment[] = allSegs.map((s) => ({
      id: s.id,
      document_id: s.documentId,
      ordinal: s.ordinal,
      text: s.text,
      locator: (s.locator ?? {}) as Record<string, unknown>,
      language: s.language as Language,
      coverage_status: s.coverageStatus as Segment['coverage_status'],
      resolved_by: (s.resolvedBy ?? 'rule') as Segment['resolved_by'],
    }));

    const audit = await runCoverageAndPreservation(
      activeReqs.map((r) => ({
        id: r.id,
        originalText: r.statementOriginal,
        normalizedText: r.statement,
        language: r.language as Language,
      })),
      mappedSegs,
      { runId: ctx.runId, router: ctx.router },
    );

    const reqById = new Map(activeReqs.map((r) => [r.id, r]));

    for (const failed of audit.failedPreservation) {
      const orig = reqById.get(failed.requirement_id);
      if (!orig) continue;

      const reasons: string[] = [];
      if (failed.lost_numbers.length > 0) reasons.push(`lost numbers/units (${failed.lost_numbers.join(', ')})`);
      if (failed.lost_negations) reasons.push('lost negation');
      if (failed.lost_modality) reasons.push('weakened mandatory modality');

      // Restore original statement safely so information is NEVER silently lost (FR-REQ-020)
      const [restored] = await db
        .update(requirements)
        .set({
          statement: orig.statementOriginal,
          status: 'needs_clarification',
          issues: [...new Set([...(orig.issues ?? []), 'PRESERVATION-001'])],
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, orig.id))
        .returning();

      await db.insert(issues).values({
        projectId: ctx.projectId,
        requirementId: orig.id,
        segmentId: null,
        kind: 'incomplete',
        ruleId: 'PRESERVATION-001',
        severity: 'error',
        reason: `Preservation guard restored original text: ${reasons.join('; ')}`,
      });

      if (restored) {
        await this.appendRequirementVersion(db, restored, 'pipeline', ctx.runId);
      }
    }

    console.log(
      `[S8] Coverage=${audit.coverageReport.coverage_pct}% (mapped=${audit.coverageReport.mapped}, not_req=${audit.coverageReport.not_requirement}, unresolved=${audit.coverageReport.unresolved}), preservation_restored=${audit.failedPreservation.length}`,
    );
  }

  // Helpers

  private async appendRequirementVersion(
    db: DatabaseInstance,
    reqRow: typeof requirements.$inferSelect,
    changedBy: string,
    runId: string,
  ): Promise<void> {
    const [maxRow] = await db
      .select({ maxVer: sql<number>`COALESCE(MAX(${requirementVersions.version}), 0)` })
      .from(requirementVersions)
      .where(eq(requirementVersions.requirementId, reqRow.id));

    const nextVer = Number(maxRow?.maxVer ?? 0) + 1;
    await db.insert(requirementVersions).values({
      requirementId: reqRow.id,
      version: nextVer,
      snapshot: reqRow as unknown as Record<string, unknown>,
      changedBy,
      runId,
    });
  }

  private async isRunCancelled(db: DatabaseInstance, runId: string): Promise<boolean> {
    try {
      const [row] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      return row?.status === 'cancelled';
    } catch {
      return false;
    }
  }

  private resolveContentType(doc: typeof documents.$inferSelect): ParseSegmentInput['contentType'] {
    const mime = (doc.mimeType ?? '').toLowerCase();
    const name = (doc.filename ?? '').toLowerCase();
    if (doc.kind === 'email' || mime.includes('message/rfc822') || name.endsWith('.eml')) {
      return 'message/rfc822';
    }
    if (mime.includes('pdf') || name.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (mime.includes('wordprocessingml') || name.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (mime.includes('markdown') || name.endsWith('.md')) {
      return 'text/markdown';
    }
    return 'text/plain';
  }

  private async readDocument(s3Key: string, binary: boolean): Promise<string | Buffer> {
    const baseDir = resolveUploadDir();
    const filePath = path.resolve(baseDir, s3Key);
    if (!filePath.startsWith(baseDir + path.sep)) {
      throw new Error(`Invalid document key: ${s3Key}`);
    }
    return binary ? fs.promises.readFile(filePath) : fs.promises.readFile(filePath, 'utf-8');
  }

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
      console.warn(`[decision_log] ${err instanceof Error ? err.message : err}`);
    }
  }
}
