import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import {
  projects,
  segments,
  requirements,
  requirementSources,
  issues,
  questions,
  runs,
  decisionLog,
} from '../../db/schema';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';
import { QueuePort } from '../../ports';
import { UsageService } from '../usage/usage.service';
import { SseService } from './sse.service';
import { loadCombinedChecklist } from '@srs-tool/knowledge';
import * as crypto from 'crypto';

export interface CreateProjectDto {
  name: string;
  platforms: ('web' | 'mobile' | 'iot' | 'shared')[];
  output_language?: 'vi' | 'en';
  constraints?: Record<string, unknown>;
}

export interface PlatformChecklistItem {
  id: string;
  platform: string;
  topic: { vi: string; en: string };
  keywords: { vi: string[]; en: string[] };
  quality: string;
  level: 'required' | 'recommended' | 'conditional';
  question: { vi: string; en: string };
  status: 'covered' | 'mentioned' | 'missing' | 'not_applicable';
  matchedRequirementId?: string;
  reason?: string;
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Inject('QUEUE_PORT') private readonly queue: QueuePort,
    private readonly usageService: UsageService,
    private readonly sseService: SseService,
  ) {}

  onModuleInit() {
    // Forward BullMQ background job progress to Server-Sent Events (SSE)
    if (this.queue.onProgress) {
      this.queue.onProgress(({ jobId, progress, data }) => {
        this.sseService.emit(jobId, 'progress', { progress, ...(typeof data === 'object' ? data : {}) });
      });
    }
    if (this.queue.onCompleted) {
      this.queue.onCompleted(({ jobId }) => {
        this.sseService.emit(jobId, 'status', { status: 'succeeded', progress: 100 });
      });
    }
    if (this.queue.onFailed) {
      this.queue.onFailed(({ jobId, failedReason }) => {
        this.sseService.emit(jobId, 'error', { status: 'failed', message: failedReason });
      });
    }
  }

  /**
   * Create a new project.
   */
  async create(data: CreateProjectDto, ownerId: string = '00000000-0000-0000-0000-000000000001') {
    if (!data.name || data.name.trim().length === 0) {
      throw new BadRequestException('Project name cannot be empty');
    }

    const id = crypto.randomUUID();
    const newProject = {
      id,
      ownerId,
      name: data.name.trim(),
      platforms: data.platforms && data.platforms.length > 0 ? data.platforms : ['web'],
      outputLanguage: data.output_language || 'vi',
      constraints: data.constraints || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(projects).values(newProject);
    } else {
      this.dbService.memProjects.set(id, newProject);
    }

    this.logger.log(`Created project '${newProject.name}' (${id}) for owner=${ownerId}`);
    return newProject;
  }

  /**
   * List all projects for a user.
   */
  async findAll(ownerId: string = '00000000-0000-0000-0000-000000000001') {
    if (this.dbService.isConnected && this.dbService.db) {
      return await this.dbService.db
        .select()
        .from(projects)
        .where(eq(projects.ownerId, ownerId))
        .orderBy(desc(projects.createdAt));
    }

    const list: any[] = [];
    for (const p of this.dbService.memProjects.values()) {
      if (p.ownerId === ownerId) list.push(p);
    }
    return list;
  }

  /**
   * Get project by ID with stats summary. Enforces ownership when `requesterId` is provided.
   */
  async findOne(id: string, requesterId?: string) {
    let project: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (found.length > 0) project = found[0];
    } else {
      project = this.dbService.memProjects.get(id);
    }

    if (!project) {
      throw new NotFoundException(`Project '${id}' not found`);
    }

    if (requesterId && project.ownerId && project.ownerId !== requesterId) {
      throw new ForbiddenException('You do not have permission to access this project');
    }

    const coverage = await this.getCoverage(id);
    return {
      ...project,
      coverage_summary: coverage,
    };
  }

  /**
   * Update project.
   */
  async update(id: string, data: Partial<CreateProjectDto>, requesterId?: string) {
    const project = await this.findOne(id, requesterId);
    const patchFields = {
      name: data.name ?? project.name,
      platforms: data.platforms ?? project.platforms,
      outputLanguage: data.output_language ?? project.outputLanguage,
      constraints: data.constraints ?? project.constraints,
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(projects).set(patchFields).where(eq(projects.id, id));
    } else {
      this.dbService.memProjects.set(id, { ...project, ...patchFields });
    }
    return this.findOne(id, requesterId);
  }

  /**
   * Delete project.
   */
  async delete(id: string, requesterId?: string) {
    await this.findOne(id, requesterId);
    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.delete(projects).where(eq(projects.id, id));
    } else {
      this.dbService.memProjects.delete(id);
    }
    return { success: true, id };
  }

  /**
   * GET /projects/:id/coverage — Real Coverage Ledger computation scoped strictly to `projectId`.
   */
  async getCoverage(projectId: string) {
    let segList: any[] = [];
    const sourcesMap = new Set<string>();

    if (this.dbService.isConnected && this.dbService.db) {
      segList = await this.dbService.db
        .select()
        .from(segments)
        .where(eq(segments.projectId, projectId));

      const segIds = segList.map((s) => s.id);
      if (segIds.length > 0) {
        const reqSources = await this.dbService.db
          .select()
          .from(requirementSources)
          .where(inArray(requirementSources.segmentId, segIds));
        for (const s of reqSources) {
          sourcesMap.add(s.segmentId);
        }
      }
    } else {
      segList = Array.from(this.dbService.memSegments.values()).filter((s) => s.projectId === projectId);
      const segIds = new Set(segList.map((s) => s.id));
      for (const links of this.dbService.memRequirementSources.values()) {
        for (const link of links) {
          if (segIds.has(link.segmentId)) {
            sourcesMap.add(link.segmentId);
          }
        }
      }
    }

    const total_segments = segList.length;
    let mapped = 0;
    let not_requirement = 0;
    let unresolved = 0;
    let unmapped = 0;

    for (const seg of segList) {
      if (sourcesMap.has(seg.id) || seg.coverageStatus === 'mapped') {
        mapped++;
      } else if (seg.coverageStatus === 'not_requirement') {
        not_requirement++;
      } else if (seg.coverageStatus === 'unresolved') {
        unresolved++;
      } else {
        unmapped++;
      }
    }

    const covered = mapped + not_requirement;
    const coverage_pct = total_segments > 0 ? Math.round((covered / total_segments) * 100) : 100;

    return {
      total_segments,
      mapped,
      not_requirement,
      unresolved,
      unmapped,
      coverage_pct,
    };
  }

  /**
   * GET /projects/:id/checklist — Platform Checklist evaluated against project requirements and segments.
   * Uses `@srs-tool/knowledge` YAML profiles (`shared.yaml` + selected platform profiles).
   */
  async getChecklist(projectId: string): Promise<PlatformChecklistItem[]> {
    const project = await this.findOne(projectId);
    const platforms: string[] = project.platforms || ['web'];
    const checklistItems = loadCombinedChecklist(platforms);

    let reqs: any[] = [];
    let segs: any[] = [];
    const dismissedIssues = new Map<string, string>(); // normalized checklist item id -> reason

    if (this.dbService.isConnected && this.dbService.db) {
      reqs = await this.dbService.db.select().from(requirements).where(eq(requirements.projectId, projectId));
      segs = await this.dbService.db.select().from(segments).where(eq(segments.projectId, projectId));
      const issueList = await this.dbService.db
        .select()
        .from(issues)
        .where(and(eq(issues.projectId, projectId), eq(issues.status, 'not_applicable')));
      for (const iss of issueList) {
        const cleanId = String(iss.ruleId || '').replace(/^CHECKLIST[-:]/i, '');
        dismissedIssues.set(cleanId, iss.reason || 'User marked not applicable');
      }
    } else {
      reqs = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
      segs = Array.from(this.dbService.memSegments.values()).filter((s) => s.projectId === projectId);
      for (const iss of this.dbService.memIssues.values()) {
        if (iss.projectId === projectId && iss.status === 'not_applicable') {
          const cleanId = String(iss.ruleId || '').replace(/^CHECKLIST[-:]/i, '');
          dismissedIssues.set(cleanId, iss.reason || 'User marked not applicable');
        }
      }
    }

    return checklistItems.map((item) => {
      if (dismissedIssues.has(item.id)) {
        return {
          ...item,
          status: 'not_applicable' as const,
          reason: dismissedIssues.get(item.id),
        };
      }

      const allKeywords = [...(item.keywords.vi || []), ...(item.keywords.en || [])].map((k) => k.toLowerCase());

      // 1. Check against extracted/normalized requirements
      for (const req of reqs) {
        if (req.status === 'rejected') continue;
        const text = `${req.statement || ''} ${req.statementOriginal || ''}`.toLowerCase();
        if (allKeywords.some((kw) => text.includes(kw))) {
          return {
            ...item,
            status: 'covered' as const,
            matchedRequirementId: req.id,
          };
        }
      }

      // 2. Check against raw segments (mentioned but not yet normalized into a requirement)
      for (const seg of segs) {
        const text = (seg.text || '').toLowerCase();
        if (allKeywords.some((kw) => text.includes(kw))) {
          return {
            ...item,
            status: 'mentioned' as const,
          };
        }
      }

      // 3. Missing
      return {
        ...item,
        status: 'missing' as const,
      };
    });
  }

  /**
   * PATCH /projects/:id/checklist/:itemId — Mark checklist item as not applicable or re-open.
   * Uses proper UUID primary keys on `issues` and canonical `CHECKLIST-<itemId>` ruleId.
   */
  async updateChecklistItem(
    projectId: string,
    itemId: string,
    data: { not_applicable: boolean; reason?: string },
  ) {
    const cleanItemId = itemId.replace(/^CHECKLIST[-:]/i, '');
    const canonicalRuleId = `CHECKLIST-${cleanItemId}`;
    const status = data.not_applicable ? 'not_applicable' : 'open';
    const reason = data.not_applicable ? data.reason || 'Marked not applicable by user' : null;

    if (this.dbService.isConnected && this.dbService.db) {
      const existing = await this.dbService.db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.projectId, projectId),
            inArray(issues.ruleId, [canonicalRuleId, cleanItemId, `CHECKLIST:${cleanItemId}`]),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await this.dbService.db
          .update(issues)
          .set({ status, reason })
          .where(eq(issues.id, existing[0]!.id));
      } else {
        await this.dbService.db.insert(issues).values({
          id: crypto.randomUUID(),
          projectId,
          requirementId: null,
          kind: 'missing',
          ruleId: canonicalRuleId,
          severity: 'warning',
          status,
          reason,
          createdAt: new Date(),
        });
      }
    } else {
      let matchedKey: string | undefined;
      for (const [k, iss] of this.dbService.memIssues.entries()) {
        const cleanRule = String(iss.ruleId || '').replace(/^CHECKLIST[-:]/i, '');
        if (iss.projectId === projectId && cleanRule === cleanItemId) {
          matchedKey = k;
          break;
        }
      }
      const id = matchedKey ?? crypto.randomUUID();
      this.dbService.memIssues.set(id, {
        id,
        projectId,
        requirementId: null,
        kind: 'missing',
        ruleId: canonicalRuleId,
        severity: 'warning',
        status,
        reason,
        createdAt: new Date(),
      });
    }

    return {
      projectId,
      itemId: cleanItemId,
      ruleId: canonicalRuleId,
      status,
      reason,
    };
  }

  /**
   * POST /projects/:id/lock-baseline — Enforces the 3 baseline gates before locking requirements:
   * 1. Coverage Ledger has 0 `unmapped` and 0 `unresolved` segments (`FR-ING-007` / `FR-REQ-011`)
   * 2. No pending clarification questions remain
   * 3. Every `origin === 'inferred'` requirement has been explicitly confirmed (`status === 'approved' | 'baseline'`, `FR-REQ-008`)
   */
  async lockBaseline(projectId: string, requesterId?: string) {
    const project = await this.findOne(projectId, requesterId);
    const coverage = await this.getCoverage(projectId);

    if (coverage.unmapped > 0 || coverage.unresolved > 0) {
      throw new ConflictException(
        `Cannot lock baseline: Coverage Ledger has ${coverage.unmapped} unmapped and ${coverage.unresolved} unresolved segment(s). Complete or clarify all segments first.`,
      );
    }

    let pendingQuestions: any[] = [];
    let activeReqs: any[] = [];

    if (this.dbService.isConnected && this.dbService.db) {
      pendingQuestions = await this.dbService.db
        .select()
        .from(questions)
        .where(and(eq(questions.projectId, projectId), eq(questions.status, 'pending')));
      activeReqs = await this.dbService.db
        .select()
        .from(requirements)
        .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));
    } else {
      pendingQuestions = Array.from(this.dbService.memQuestions.values()).filter(
        (q) => q.projectId === projectId && q.status === 'pending',
      );
      activeReqs = Array.from(this.dbService.memRequirements.values()).filter(
        (r) => r.projectId === projectId && r.status !== 'rejected',
      );
    }

    if (pendingQuestions.length > 0) {
      throw new ConflictException(
        `Cannot lock baseline: ${pendingQuestions.length} clarification question(s) are still pending. Answer or skip them first.`,
      );
    }

    const unconfirmedInferred = activeReqs.filter(
      (r) => r.origin === 'inferred' && r.status !== 'approved' && r.status !== 'baseline',
    );
    if (unconfirmedInferred.length > 0) {
      const codes = unconfirmedInferred.map((r) => r.code).join(', ');
      throw new ConflictException(
        `Cannot lock baseline: inferred requirement(s) [${codes}] must be explicitly confirmed before baseline lock (FR-REQ-008).`,
      );
    }

    const now = new Date();
    if (this.dbService.isConnected && this.dbService.db) {
      if (activeReqs.length > 0) {
        await this.dbService.db
          .update(requirements)
          .set({ status: 'baseline', updatedAt: now })
          .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));
      }
      await this.dbService.db
        .update(projects)
        .set({
          constraints: {
            ...(project.constraints || {}),
            baseline_locked: true,
            baseline_locked_at: now.toISOString(),
          },
          updatedAt: now,
        })
        .where(eq(projects.id, projectId));
    } else {
      for (const r of activeReqs) {
        r.status = 'baseline';
        r.updatedAt = now;
      }
      const memProj = this.dbService.memProjects.get(projectId);
      if (memProj) {
        memProj.constraints = {
          ...(memProj.constraints || {}),
          baseline_locked: true,
          baseline_locked_at: now.toISOString(),
        };
        memProj.updatedAt = now;
      }
    }

    return {
      project_id: projectId,
      status: 'baseline_locked',
      locked_requirements: activeReqs.length,
      locked_at: now.toISOString(),
      coverage,
    };
  }

  /**
   * POST /projects/:id/runs — Start a pipeline run.
   */
  async startRun(
    projectId: string,
    options: { mode?: 'eco' | 'standard' | 'thorough'; from_stage?: number },
    userId: string = '00000000-0000-0000-0000-000000000001',
  ) {
    await this.findOne(projectId);
    const runId = crypto.randomUUID();
    const mode = options.mode || 'standard';
    const fromStage = options.from_stage || 1;

    // Estimate token quota: eco=0, standard=5000, thorough=15000
    const estimatedTokens = mode === 'eco' ? 0 : mode === 'thorough' ? 15000 : 5000;

    if (estimatedTokens > 0) {
      await this.usageService.reserve(userId, estimatedTokens, runId);
    }

    const runRecord = {
      id: runId,
      projectId,
      kind: 'pipeline',
      mode,
      fromStage,
      status: 'queued',
      progress: 0,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(runs).values(runRecord);
    } else {
      this.dbService.memRuns.set(runId, runRecord);
    }

    await this.queue.enqueue({
      type: 'pipeline',
      projectId,
      runId,
      mode,
      fromStage,
    });

    this.sseService.emit(runId, 'status', { status: 'queued', progress: 0, mode });

    this.logger.log(`Created Run ${runId} for project=${projectId} (mode=${mode}, fromStage=${fromStage})`);
    return {
      run_id: runId,
      projectId,
      mode,
      from_stage: fromStage,
      status: 'queued',
      estimated_tokens: estimatedTokens,
    };
  }

  /**
   * GET /runs/:id — Get run status and progress.
   */
  async getRun(runId: string) {
    let run: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (found.length > 0) run = found[0];
    } else {
      run = this.dbService.memRuns.get(runId);
    }

    if (!run) throw new NotFoundException(`Run '${runId}' not found`);

    const qStatus = await this.queue.getJobStatus(runId);
    return {
      ...run,
      queue_status: qStatus.status,
    };
  }

  /**
   * GET /runs/:id/decisions — Tier statistics and decision log entries.
   */
  async getRunDecisions(runId: string) {
    let logs: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      logs = await this.dbService.db.select().from(decisionLog).where(eq(decisionLog.runId, runId));
    } else {
      logs = this.dbService.memDecisionLogs.filter((l) => l.runId === runId);
    }

    let tier0Count = 0;
    let tier1Count = 0;
    let tier2Count = 0;
    const pendingLlm: any[] = [];
    const needsReview: any[] = [];

    for (const l of logs) {
      if (l.tier === 'rule') tier0Count++;
      else if (l.tier === 'local') tier1Count++;
      else if (l.tier === 'llm') tier2Count++;

      if (l.status === 'pending_llm') pendingLlm.push(l);
      if (l.status === 'needs_review') needsReview.push(l);
    }

    const total = logs.length || 1;
    return {
      run_id: runId,
      total_decisions: logs.length,
      tier_breakdown: {
        tier0_rule_pct: Math.round((tier0Count / total) * 100),
        tier1_local_pct: Math.round((tier1Count / total) * 100),
        tier2_llm_pct: Math.round((tier2Count / total) * 100),
      },
      pending_llm_items: pendingLlm,
      needs_review_items: needsReview,
    };
  }

  /**
   * POST /runs/:id/escalate — Escalate pending LLM items.
   */
  async escalateRun(runId: string, userId: string = '00000000-0000-0000-0000-000000000001') {
    const run = await this.getRun(runId);
    const usage = await this.usageService.getCurrentUsage(userId);

    if (usage.remainingTokens < 2000) {
      throw new ForbiddenException('Insufficient token quota to escalate LLM items');
    }

    await this.queue.enqueue({
      type: 'pipeline',
      projectId: run.projectId,
      runId,
      mode: 'standard',
      escalate: true,
    });

    this.sseService.emit(runId, 'status', { status: 'running', message: 'Escalating pending LLM items' });
    return { run_id: runId, status: 'escalating' };
  }

  /**
   * POST /runs/:id/cancel — Cancel a running/queued pipeline run (FR-RVW-007).
   */
  async cancelRun(runId: string) {
    const run = await this.getRun(runId);
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
      return { run_id: runId, status: run.status };
    }

    const now = new Date();
    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .update(runs)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(runs.id, runId));
    } else {
      const memRun = this.dbService.memRuns.get(runId);
      if (memRun) {
        memRun.status = 'cancelled';
        memRun.updatedAt = now;
      }
    }

    this.sseService.emit(runId, 'status', { status: 'cancelled', message: 'Run cancelled by user' });
    return { run_id: runId, status: 'cancelled' };
  }

  /**
   * SSE Stream for Run events.
   */
  getRunEventStream(runId: string) {
    return this.sseService.getEventStream(runId);
  }
}
