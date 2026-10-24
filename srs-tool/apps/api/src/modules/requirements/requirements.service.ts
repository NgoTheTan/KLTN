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
} from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { QueuePort } from '../../ports';

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
  async findAll(projectId: string, filters: RequirementFilters) {
    let list: any[] = [];

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        list = await this.dbService.db
          .select()
          .from(requirements)
          .where(eq(requirements.projectId, projectId))
          .orderBy(desc(requirements.createdAt));
      } catch {
        list = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
      }
    } else {
      list = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
    }

    // Apply in-memory filters
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
      try {
        const found = await this.dbService.db
          .select()
          .from(requirements)
          .where(and(eq(requirements.id, id), eq(requirements.projectId, projectId)))
          .limit(1);
        if (found.length > 0) req = found[0];
      } catch {}
    }
    if (!req) {
      const found = this.dbService.memRequirements.get(id);
      if (found && found.projectId === projectId) req = found;
    }

    if (!req) {
      throw new NotFoundException(`Requirement '${id}' not found in project '${projectId}'`);
    }

    // Get sources
    const sources = await this.getRequirementSources(id);

    // Get version history
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
      try {
        await this.dbService.db.insert(requirements).values(record);
      } catch {
        this.dbService.memRequirements.set(id, record);
      }
    } else {
      this.dbService.memRequirements.set(id, record);
    }

    // Record Version 1
    await this.recordVersion(id, 1, record, changedBy);

    // Link source segments if provided
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
   */
  async update(projectId: string, id: string, dto: Partial<CreateRequirementDto>, changedBy: string = 'user') {
    const current = await this.findOne(projectId, id);
    const nextVersion = (current.versions?.length || 0) + 1;

    const updated = {
      ...current,
      statement: dto.statement ?? current.statement,
      type: dto.type ?? current.type,
      priority: dto.priority ?? current.priority,
      earsPattern: dto.ears_pattern ?? current.earsPattern,
      rationale: dto.rationale ?? current.rationale,
      acceptanceCriteria: dto.acceptance_criteria ?? current.acceptanceCriteria,
      verificationMethod: dto.verification_method ?? current.verificationMethod,
      metric: dto.metric ?? current.metric,
      isAsr: dto.is_asr ?? current.isAsr,
      updatedAt: new Date(),
    };

    delete updated.sources;
    delete updated.versions;

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.update(requirements).set(updated).where(eq(requirements.id, id));
      } catch {}
    }
    this.dbService.memRequirements.set(id, updated);

    // Record new version snapshot
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
      try {
        await this.dbService.db.update(requirements).set(restored).where(eq(requirements.id, id));
      } catch {}
    }
    this.dbService.memRequirements.set(id, restored);

    await this.recordVersion(id, nextVersion, restored, `revert_to_v${targetVersion}`);

    this.logger.log(`Reverted requirement ${id} to version ${targetVersion}`);
    return this.findOne(projectId, id);
  }

  /**
   * Compare two versions of a requirement.
   */
  async diff(projectId: string, id: string, v1: number, v2: number) {
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
      try {
        return await this.dbService.db
          .select()
          .from(questions)
          .where(eq(questions.projectId, projectId))
          .orderBy(desc(questions.createdAt));
      } catch {}
    }
    return Array.from(this.dbService.memQuestions.values()).filter((q) => q.projectId === projectId);
  }

  /**
   * POST /questions/:id/answer — Answer clarification question.
   * Creates a new Segment, closes the question, updates linked issue, and enqueues re-run from Stage 4/6.
   */
  async answerQuestion(questionId: string, answer: string, skip: boolean = false) {
    let q: any;
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
        if (found.length > 0) q = found[0];
      } catch {}
    }
    if (!q) q = this.dbService.memQuestions.get(questionId);

    if (!q) throw new NotFoundException(`Question '${questionId}' not found`);

    let answerSegmentId: string | null = null;

    if (!skip && answer && answer.trim().length > 0) {
      // 1. Save user answer as a new Segment (doc line 634: "lưu câu trả lời như một Segment mới")
      answerSegmentId = crypto.randomUUID();
      const newSegment = {
        id: answerSegmentId,
        documentId: q.issueId || q.projectId,
        projectId: q.projectId,
        ordinal: 9999,
        text: answer.trim(),
        locator: { source: 'user_clarification', question_id: questionId },
        language: 'vi',
        coverageStatus: 'mapped',
        resolvedBy: 'rule',
        createdAt: new Date(),
      };

      if (this.dbService.isConnected && this.dbService.db) {
        try {
          await this.dbService.db.insert(segments).values(newSegment);
        } catch {}
      }
      this.dbService.memSegments.set(answerSegmentId, newSegment);
    }

    // 2. Close Question
    const status = skip ? 'skipped' : 'answered';
    const updatedQ = {
      ...q,
      answer: answer || null,
      answerSegmentId,
      status,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db
          .update(questions)
          .set({ answer: updatedQ.answer, answerSegmentId, status })
          .where(eq(questions.id, questionId));
      } catch {}
    }
    this.dbService.memQuestions.set(questionId, updatedQ);

    // 3. Mark linked Issue as resolved
    if (q.issueId) {
      if (this.dbService.isConnected && this.dbService.db) {
        try {
          await this.dbService.db
            .update(issues)
            .set({ status: 'resolved', reason: `Clarified by user: ${answer}` })
            .where(eq(issues.id, q.issueId));
        } catch {}
      }
      const iss = this.dbService.memIssues.get(q.issueId);
      if (iss) {
        iss.status = 'resolved';
        iss.reason = `Clarified by user: ${answer}`;
      }
    }

    // 4. Trigger re-run from Stage 4 (doc line 636: "chạy lại từ giai đoạn 4 cho các yêu cầu bị ảnh hưởng")
    const rerunId = crypto.randomUUID();
    await this.queue.enqueue({
      type: 'pipeline',
      projectId: q.projectId,
      runId: rerunId,
      fromStage: 4,
      mode: 'standard',
    });

    this.logger.log(`Answered question ${questionId}. Created segment ${answerSegmentId}. Re-running pipeline from S4.`);
    return {
      question_id: questionId,
      status,
      answer_segment_id: answerSegmentId,
      re_run_id: rerunId,
    };
  }

  /**
   * Bilingual Glossary: GET /projects/:id/glossary
   */
  async getGlossary(projectId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        return await this.dbService.db
          .select()
          .from(glossaryTerms)
          .where(eq(glossaryTerms.projectId, projectId));
      } catch {}
    }
    return Array.from(this.dbService.memGlossary.values()).filter((g) => g.projectId === projectId);
  }

  /**
   * Bilingual Glossary: POST /projects/:id/glossary
   */
  async addGlossaryTerm(projectId: string, data: { term_vi: string; term_en: string; definition: string }) {
    const id = crypto.randomUUID();
    const term = {
      id,
      projectId,
      termVi: data.term_vi,
      termEn: data.term_en,
      definition: data.definition,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(glossaryTerms).values(term);
      } catch {}
    }
    this.dbService.memGlossary.set(id, term);
    return term;
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
      try {
        await this.dbService.db.insert(requirementVersions).values(record);
      } catch {}
    }

    const list = this.dbService.memRequirementVersions.get(requirementId) || [];
    list.push(record);
    this.dbService.memRequirementVersions.set(requirementId, list);
  }

  private async linkSource(requirementId: string, segmentId: string, quote?: string) {
    const link = {
      requirementId,
      segmentId,
      quote: quote || null,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(requirementSources).values(link);
      } catch {}
    }

    const list = this.dbService.memRequirementSources.get(requirementId) || [];
    list.push(link);
    this.dbService.memRequirementSources.set(requirementId, list);
  }

  private async getRequirementSources(requirementId: string) {
    const links: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db
          .select()
          .from(requirementSources)
          .where(eq(requirementSources.requirementId, requirementId));
        return found;
      } catch {}
    }
    return this.dbService.memRequirementSources.get(requirementId) || [];
  }

  private async getRequirementVersions(requirementId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        return await this.dbService.db
          .select()
          .from(requirementVersions)
          .where(eq(requirementVersions.requirementId, requirementId))
          .orderBy(desc(requirementVersions.version));
      } catch {}
    }
    const list = this.dbService.memRequirementVersions.get(requirementId) || [];
    return [...list].reverse();
  }
}
