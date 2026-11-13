import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import {
  requirements,
  requirementVersions,
  requirementSources,
  segments,
  questions,
  issues,
  glossaryTerms,
  runs,
} from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { QueuePort } from '../../ports';
import * as crypto from 'crypto';

export interface RequirementFilters {
  type?: string;
  platform?: string;
  status?: string;
  ears_pattern?: string;
  is_asr?: boolean;
  min_quality_score?: number;
  search?: string;
}

export interface CreateRequirementDto {
  code?: string;
  type: 'functional' | 'non-functional' | 'constraint' | 'interface' | 'assumption';
  platforms: string[];
  ears_pattern: 'ubiquitous' | 'event-driven' | 'state-driven' | 'optional' | 'unwanted' | 'complex';
  statement: string;
  statement_original?: string;
  language?: 'vi' | 'en';
  rationale?: string;
  acceptance_criteria?: string;
  verification_method?: 'test' | 'analysis' | 'inspection' | 'demonstration';
  priority?: 'must' | 'should' | 'could' | 'wont';
  metric?: Record<string, unknown>;
  is_asr?: boolean;
  origin?: 'explicit' | 'inferred' | 'assumption';
  source_segment_ids?: string[];
}

export interface UpdateRequirementDto extends Partial<CreateRequirementDto> {
  status?: 'candidate' | 'needs_clarification' | 'approved' | 'rejected' | 'baseline';
  confirm_inferred?: boolean;
}

@Injectable()
export class RequirementsService {
  private readonly logger = new Logger(RequirementsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Inject('QUEUE_PORT') private readonly queue: QueuePort,
  ) {}

  /**
   * List requirements with rich filtering.
   */
  async findAll(projectId: string, filters: RequirementFilters = {}) {
    let list: any[] = [];

    if (this.dbService.isConnected && this.dbService.db) {
      list = await this.dbService.db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId))
        .orderBy(desc(requirements.createdAt));
    } else {
      list = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
    }

    return list.filter((r) => {
      if (filters.type && r.type !== filters.type) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.ears_pattern && r.earsPattern !== filters.ears_pattern) return false;
      if (filters.is_asr !== undefined && r.isAsr !== filters.is_asr) return false;
      if (filters.min_quality_score !== undefined && (r.qualityScore || 0) < filters.min_quality_score) return false;
      if (filters.platform && !r.platforms?.includes(filters.platform)) return false;
      if (filters.search) {
        const query = filters.search.toLowerCase();
        const text = `${r.code} ${r.statement} ${r.statementOriginal}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
  }

  /**
   * Get single requirement with source citations and version history.
   */
  async findOne(projectId: string, id: string) {
    let req: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db
        .select()
        .from(requirements)
        .where(and(eq(requirements.id, id), eq(requirements.projectId, projectId)))
        .limit(1);
      if (found.length > 0) req = found[0];
    } else {
      const found = this.dbService.memRequirements.get(id);
      if (found && found.projectId === projectId) req = found;
    }

    if (!req) {
      throw new NotFoundException(`Requirement '${id}' not found in project '${projectId}'`);
    }

    const sources = await this.getRequirementSources(id);
    const versions = await this.getRequirementVersions(id);

    return {
      ...req,
      sources,
      versions,
    };
  }

  /**
   * Create a requirement manually.
   */
  async create(projectId: string, dto: CreateRequirementDto, changedBy: string = 'user') {
    const id = crypto.randomUUID();
    const code = dto.code || `REQ-${Date.now().toString(36).substring(4).toUpperCase()}`;

    const record = {
      id,
      projectId,
      code,
      type: dto.type,
      platforms: dto.platforms || ['web'],
      earsPattern: dto.ears_pattern || 'ubiquitous',
      statement: dto.statement,
      statementOriginal: dto.statement_original || dto.statement,
      language: dto.language || 'vi',
      rationale: dto.rationale || null,
      acceptanceCriteria: dto.acceptance_criteria || null,
      verificationMethod: dto.verification_method || 'test',
      priority: dto.priority || 'should',
      metric: dto.metric || null,
      isAsr: dto.is_asr || false,
      origin: dto.origin || 'explicit',
      status: 'candidate',
      qualityScore: 100,
      issues: [],
      resolvedBy: 'rule',
      confidence: 1.0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(requirements).values(record);
    } else {
      this.dbService.memRequirements.set(id, record);
    }

    await this.recordVersion(id, 1, record, changedBy);

    if (dto.source_segment_ids && dto.source_segment_ids.length > 0) {
      for (const segId of dto.source_segment_ids) {
        await this.linkSource(id, segId);
      }
    }

    this.logger.log(`Created requirement ${code} (${id})`);
    return record;
  }

  /**
   * Update requirement and save snapshot in requirement_versions.
   * Enforces explicit confirmation for `origin === 'inferred'` requirements before approval (FR-REQ-008).
   */
  async update(projectId: string, id: string, dto: UpdateRequirementDto, changedBy: string = 'user') {
    const current = await this.findOne(projectId, id);

    if (
      current.origin === 'inferred' &&
      (dto.status === 'approved' || dto.status === 'baseline') &&
      current.status !== 'approved' &&
      current.status !== 'baseline' &&
      !dto.confirm_inferred
    ) {
      throw new BadRequestException(
        'Inferred requirement must be explicitly confirmed (confirm_inferred: true) before approval (FR-REQ-008)',
      );
    }

    const nextVersion = (current.versions?.length || 0) + 1;

    const updated = {
      ...current,
      statement: dto.statement ?? current.statement,
      type: dto.type ?? current.type,
      platforms: dto.platforms ?? current.platforms,
      priority: dto.priority ?? current.priority,
      earsPattern: dto.ears_pattern ?? current.earsPattern,
      rationale: dto.rationale ?? current.rationale,
      acceptanceCriteria: dto.acceptance_criteria ?? current.acceptanceCriteria,
      verificationMethod: dto.verification_method ?? current.verificationMethod,
      metric: dto.metric ?? current.metric,
      isAsr: dto.is_asr ?? current.isAsr,
      origin: dto.origin ?? current.origin,
      status: dto.status ?? current.status,
      updatedAt: new Date(),
    };

    delete updated.sources;
    delete updated.versions;

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(requirements).set(updated).where(eq(requirements.id, id));
    } else {
      this.dbService.memRequirements.set(id, updated);
    }

    await this.recordVersion(id, nextVersion, updated, changedBy);

    return this.findOne(projectId, id);
  }

  /**
   * Revert requirement to a past version.
   */
  async revert(projectId: string, id: string, targetVersion: number) {
    const versions = await this.getRequirementVersions(id);
    const target = versions.find((v: any) => v.version === targetVersion);

    if (!target) {
      throw new NotFoundException(`Version ${targetVersion} for requirement ${id} not found`);
    }

    const snapshot = target.snapshot;
    const nextVersion = versions.length + 1;

    const restored = {
      ...snapshot,
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(requirements).set(restored).where(eq(requirements.id, id));
    } else {
      this.dbService.memRequirements.set(id, restored);
    }

    await this.recordVersion(id, nextVersion, restored, `revert_to_v${targetVersion}`);

    this.logger.log(`Reverted requirement ${id} to version ${targetVersion}`);
    return this.findOne(projectId, id);
  }

  /**
   * Compare two versions of a requirement.
   */
  async diff(_projectId: string, id: string, v1: number, v2: number) {
    const versions = await this.getRequirementVersions(id);
    const ver1 = versions.find((v: any) => v.version === v1);
    const ver2 = versions.find((v: any) => v.version === v2);

    if (!ver1 || !ver2) {
      throw new NotFoundException(`One or both specified versions (${v1}, ${v2}) not found`);
    }

    return {
      requirement_id: id,
      version_1: ver1,
      version_2: ver2,
      statement_changed: ver1.snapshot.statement !== ver2.snapshot.statement,
      diff: {
        v1_statement: ver1.snapshot.statement,
        v2_statement: ver2.snapshot.statement,
      },
    };
  }

  /**
   * GET /projects/:id/questions — Clarification questions from Stage 5.
   */
  async getQuestions(projectId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(questions)
        .where(eq(questions.projectId, projectId))
        .orderBy(desc(questions.createdAt));
    }
    return Array.from(this.dbService.memQuestions.values()).filter((q) => q.projectId === projectId);
  }

  /**
   * POST /questions/:id/answer — Answer or skip a clarification question (FR-REQ-006, FR-REQ-007).
   * - When answered: creates a traced `Segment` (`documentId: null`), updates/creates the target requirement,
   *   closes the question + issue, and enqueues a pipeline re-run from Stage 4.
   * - When skipped (`skip: true`): marks target requirement `origin = 'assumption'` (or records an assumption
   *   requirement for checklist gaps), closes question as `skipped`, and enqueues re-run from Stage 4.
   */
  async answerQuestion(questionId: string, answer: string, skip: boolean = false) {
    let q: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
      if (found.length > 0) q = found[0];
    } else {
      q = this.dbService.memQuestions.get(questionId);
    }

    if (!q) throw new NotFoundException(`Question '${questionId}' not found`);
    if (!skip && (!answer || answer.trim().length === 0)) {
      throw new BadRequestException('Answer text is required unless skip=true');
    }

    let linkedIssue: any = null;
    if (q.issueId) {
      if (this.dbService.isConnected && this.dbService.db) {
        const issRows = await this.dbService.db.select().from(issues).where(eq(issues.id, q.issueId)).limit(1);
        linkedIssue = issRows[0] ?? null;
      } else {
        linkedIssue = this.dbService.memIssues.get(q.issueId) ?? null;
      }
    }

    const ruleId = String(q.ruleId || linkedIssue?.ruleId || '');
    const targetReqId: string | null = linkedIssue?.requirementId ?? null;
    let answerSegmentId: string | null = null;
    let updatedRequirementId: string | null = targetReqId;

    if (!skip) {
      // 1. Save user answer as a new Segment with `documentId: null` (user clarification segment)
      answerSegmentId = crypto.randomUUID();
      const nextOrdinal = await this.getNextSegmentOrdinal(q.projectId);
      const newSegment = {
        id: answerSegmentId,
        documentId: null,
        projectId: q.projectId,
        ordinal: nextOrdinal,
        text: answer.trim(),
        locator: { source: 'user_clarification', question_id: questionId },
        language: 'vi',
        coverageStatus: 'mapped',
        resolvedBy: 'rule',
        createdAt: new Date(),
      };

      if (this.dbService.isConnected && this.dbService.db) {
        await this.dbService.db.insert(segments).values(newSegment);
      } else {
        this.dbService.memSegments.set(answerSegmentId, newSegment);
      }

      // 2. Link & enrich target requirement, or create new requirement for missing checklist topic
      if (targetReqId) {
        await this.linkSource(targetReqId, answerSegmentId, answer.trim());
        const existingReq = await this.findOne(q.projectId, targetReqId).catch(() => null);
        if (existingReq) {
          const mergedStatement = `${existingReq.statement.replace(/\.\s*$/, '')} (${answer.trim()}).`;
          await this.update(
            q.projectId,
            targetReqId,
            {
              statement: mergedStatement,
              status: 'candidate',
              rationale: existingReq.rationale
                ? `${existingReq.rationale} | Clarified: ${answer.trim()}`
                : `Clarified by user: ${answer.trim()}`,
            },
            'user_clarification',
          );
        }
      } else if (ruleId.startsWith('CHECKLIST')) {
        const created = await this.create(
          q.projectId,
          {
            type: 'non-functional',
            platforms: ['shared'],
            ears_pattern: 'ubiquitous',
            statement: answer.trim(),
            statement_original: answer.trim(),
            origin: 'explicit',
            rationale: `Clarified from checklist gap ${ruleId}`,
            source_segment_ids: [answerSegmentId],
          },
          'user_clarification',
        );
        updatedRequirementId = created.id;
      }
    } else {
      // Skip path (FR-REQ-007): mark linked requirement (or checklist gap) with `origin = 'assumption'`
      const assumptionNote = answer?.trim()
        ? `Skipped clarification (${answer.trim()})`
        : `User skipped question '${q.text}' — treated as explicit assumption`;

      if (targetReqId) {
        const existingReq = await this.findOne(q.projectId, targetReqId).catch(() => null);
        if (existingReq) {
          await this.update(
            q.projectId,
            targetReqId,
            {
              origin: 'assumption',
              status: 'candidate',
              rationale: existingReq.rationale
                ? `${existingReq.rationale} | ${assumptionNote}`
                : assumptionNote,
            },
            'user_skip_assumption',
          );
        }
      } else if (ruleId.startsWith('CHECKLIST')) {
        const created = await this.create(
          q.projectId,
          {
            type: 'assumption',
            platforms: ['shared'],
            ears_pattern: 'ubiquitous',
            statement: answer?.trim() || `Giả định cho mục ${ruleId}: áp dụng giá trị mặc định của hồ sơ nền tảng.`,
            origin: 'assumption',
            rationale: assumptionNote,
          },
          'user_skip_assumption',
        );
        updatedRequirementId = created.id;
      }
    }

    // 3. Close Question
    const status = skip ? 'skipped' : 'answered';
    const finalAnswer = answer?.trim() ? answer.trim() : null;
    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .update(questions)
        .set({ answer: finalAnswer, answerSegmentId, status })
        .where(eq(questions.id, questionId));
    } else {
      this.dbService.memQuestions.set(questionId, {
        ...q,
        answer: finalAnswer,
        answerSegmentId,
        status,
      });
    }

    // 4. Mark linked Issue as resolved
    if (q.issueId) {
      const resolutionReason = skip
        ? 'Skipped by user — recorded as assumption'
        : `Clarified by user: ${finalAnswer}`;
      if (this.dbService.isConnected && this.dbService.db) {
        await this.dbService.db
          .update(issues)
          .set({ status: 'resolved', reason: resolutionReason })
          .where(eq(issues.id, q.issueId));
      } else {
        const iss = this.dbService.memIssues.get(q.issueId);
        if (iss) {
          iss.status = 'resolved';
          iss.reason = resolutionReason;
        }
      }
    }

    // 5. Persist re-run record & enqueue from Stage 4 (eco mode -> 0 tokens)
    const rerunId = crypto.randomUUID();
    const runRecord = {
      id: rerunId,
      projectId: q.projectId,
      kind: 'pipeline',
      mode: 'eco',
      fromStage: 4,
      status: 'queued',
      progress: 0,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(runs).values(runRecord);
    } else {
      this.dbService.memRuns.set(rerunId, runRecord);
    }

    await this.queue.enqueue({
      type: 'pipeline',
      projectId: q.projectId,
      runId: rerunId,
      fromStage: 4,
      mode: 'eco',
    });

    this.logger.log(
      `Processed question ${questionId} (status=${status}, segment=${answerSegmentId ?? 'none'}). Re-running from S4 (${rerunId}).`,
    );
    return {
      question_id: questionId,
      status,
      answer_segment_id: answerSegmentId,
      requirement_id: updatedRequirementId,
      re_run_id: rerunId,
    };
  }

  /**
   * Bilingual Glossary: GET /projects/:id/glossary
   */
  async getGlossary(projectId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(glossaryTerms)
        .where(eq(glossaryTerms.projectId, projectId));
    }
    return Array.from(this.dbService.memGlossary.values()).filter((g) => g.projectId === projectId);
  }

  /**
   * Bilingual Glossary: POST /projects/:id/glossary
   */
  async addGlossaryTerm(projectId: string, data: { term_vi: string; term_en: string; definition: string }) {
    if (!data.term_vi && !data.term_en) {
      throw new BadRequestException('At least one of term_vi or term_en must be provided');
    }

    const id = crypto.randomUUID();
    const term = {
      id,
      projectId,
      termVi: data.term_vi || data.term_en,
      termEn: data.term_en || data.term_vi,
      definition: data.definition || '',
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(glossaryTerms).values(term);
    } else {
      this.dbService.memGlossary.set(id, term);
    }
    return term;
  }

  private async getNextSegmentOrdinal(projectId: string): Promise<number> {
    if (this.dbService.isConnected && this.dbService.db) {
      const existing = await this.dbService.db
        .select()
        .from(segments)
        .where(eq(segments.projectId, projectId));
      return existing.reduce((max, s) => Math.max(max, s.ordinal ?? 0), 0) + 1;
    }
    let max = 0;
    for (const s of this.dbService.memSegments.values()) {
      if (s.projectId === projectId && (s.ordinal ?? 0) > max) {
        max = s.ordinal;
      }
    }
    return max + 1;
  }

  private async recordVersion(requirementId: string, version: number, snapshot: any, changedBy: string) {
    const record = {
      requirementId,
      version,
      snapshot,
      changedBy,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(requirementVersions).values(record);
    } else {
      const list = this.dbService.memRequirementVersions.get(requirementId) || [];
      list.push(record);
      this.dbService.memRequirementVersions.set(requirementId, list);
    }
  }

  private async linkSource(requirementId: string, segmentId: string, quote?: string) {
    const link = {
      requirementId,
      segmentId,
      quote: quote || null,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .insert(requirementSources)
        .values(link)
        .onConflictDoNothing();
    } else {
      const list = this.dbService.memRequirementSources.get(requirementId) || [];
      if (!list.some((l) => l.segmentId === segmentId)) {
        list.push(link);
        this.dbService.memRequirementSources.set(requirementId, list);
      }
    }
  }

  private async getRequirementSources(requirementId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(requirementSources)
        .where(eq(requirementSources.requirementId, requirementId));
    }
    return this.dbService.memRequirementSources.get(requirementId) || [];
  }

  private async getRequirementVersions(requirementId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(requirementVersions)
        .where(eq(requirementVersions.requirementId, requirementId))
        .orderBy(desc(requirementVersions.version));
    }
    const list = this.dbService.memRequirementVersions.get(requirementId) || [];
    return [...list].reverse();
  }
}
