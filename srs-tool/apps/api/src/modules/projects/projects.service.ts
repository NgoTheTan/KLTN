import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { projects, documents, segments, requirements, requirementSources, issues, runs, decisionLog } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { QueuePort } from '../../ports';
import { UsageService } from '../usage/usage.service';
import { SseService } from './sse.service';
import * as fs from 'fs';
import * as path from 'path';

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
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Inject('QUEUE_PORT') private readonly queue: QueuePort,
    private readonly usageService: UsageService,
    private readonly sseService: SseService,
  ) {}

  /**
   * Create a new project.
   */
  async create(data: CreateProjectDto, ownerId: string = '00000000-0000-0000-0000-000000000001') {
    const id = crypto.randomUUID();
    const newProject = {
      id,
      ownerId,
      name: data.name,
      platforms: data.platforms || ['web'],
      outputLanguage: data.output_language || 'vi',
      constraints: data.constraints || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(projects).values(newProject);
      } catch (err: any) {
        this.logger.warn(`Failed to insert project into DB (${err.message}). Using memory fallback.`);
        this.dbService.memProjects.set(id, newProject);
      }
    } else {
      this.dbService.memProjects.set(id, newProject);
    }

    this.logger.log(`Created project '${data.name}' (${id}) for owner=${ownerId}`);
    return newProject;
  }

  /**
   * List all projects for a user.
   */
  async findAll(ownerId: string = '00000000-0000-0000-0000-000000000001') {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        return await this.dbService.db
          .select()
          .from(projects)
          .where(eq(projects.ownerId, ownerId))
          .orderBy(desc(projects.createdAt));
      } catch {}
    }

    const list: any[] = [];
    for (const p of this.dbService.memProjects.values()) {
      if (p.ownerId === ownerId) list.push(p);
    }
    return list;
  }

  /**
   * Get project by ID with stats summary.
   */
  async findOne(id: string) {
    let project: any;
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(projects).where(eq(projects.id, id)).limit(1);
        if (found.length > 0) project = found[0];
      } catch {}
    }
    if (!project) {
      project = this.dbService.memProjects.get(id);
    }

    if (!project) {
      throw new NotFoundException(`Project '${id}' not found`);
    }

    // Attach counts
    const coverage = await this.getCoverage(id);
    return {
      ...project,
      coverage_summary: coverage,
    };
  }

  /**
   * Update project.
   */
  async update(id: string, data: Partial<CreateProjectDto>) {
    const project = await this.findOne(id);
    const updated = {
      ...project,
      name: data.name ?? project.name,
      platforms: data.platforms ?? project.platforms,
      outputLanguage: data.output_language ?? project.outputLanguage,
      constraints: data.constraints ?? project.constraints,
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.update(projects).set(updated).where(eq(projects.id, id));
      } catch {}
    }
    this.dbService.memProjects.set(id, updated);
    return updated;
  }

  /**
   * Delete project.
   */
  async delete(id: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.delete(projects).where(eq(projects.id, id));
      } catch {}
    }
    this.dbService.memProjects.delete(id);
    return { success: true, id };
  }

  /**
   * GET /projects/:id/coverage — Real Coverage Ledger computation.
   */
  async getCoverage(projectId: string) {
    let segList: any[] = [];
    let sourcesMap = new Set<string>();

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        segList = await this.dbService.db
          .select()
          .from(segments)
          .where(eq(segments.projectId, projectId));

        const reqSources = await this.dbService.db.select().from(requirementSources);
        for (const s of reqSources) {
          sourcesMap.add(s.segmentId);
        }
      } catch {
        segList = Array.from(this.dbService.memSegments.values()).filter((s) => s.projectId === projectId);
      }
    } else {
      segList = Array.from(this.dbService.memSegments.values()).filter((s) => s.projectId === projectId);
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
   */
  async getChecklist(projectId: string): Promise<PlatformChecklistItem[]> {
    const project = await this.findOne(projectId);
    const platforms: string[] = project.platforms || ['web'];
    const checklistItems = this.loadPlatformChecklist(platforms);

    // Get requirements and segments for keyword matching
    let reqs: any[] = [];
    let segs: any[] = [];
    let dismissedIssues = new Map<string, string>(); // ruleId -> reason

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        reqs = await this.dbService.db.select().from(requirements).where(eq(requirements.projectId, projectId));
        segs = await this.dbService.db.select().from(segments).where(eq(segments.projectId, projectId));
        const issueList = await this.dbService.db
          .select()
          .from(issues)
          .where(and(eq(issues.projectId, projectId), eq(issues.status, 'not_applicable')));
        for (const iss of issueList) {
          dismissedIssues.set(iss.ruleId, iss.reason || 'User marked not applicable');
        }
      } catch {}
    } else {
      reqs = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
      segs = Array.from(this.dbService.memSegments.values()).filter((s) => s.projectId === projectId);
      for (const iss of this.dbService.memIssues.values()) {
        if (iss.projectId === projectId && iss.status === 'not_applicable') {
          dismissedIssues.set(iss.ruleId, iss.reason || 'User marked not applicable');
        }
      }
    }

    return checklistItems.map((item) => {
      // Check if user marked not applicable
      if (dismissedIssues.has(item.id)) {
        return {
          ...item,
          status: 'not_applicable',
          reason: dismissedIssues.get(item.id),
        };
      }

      const allKeywords = [...(item.keywords.vi || []), ...(item.keywords.en || [])].map((k) => k.toLowerCase());

      // 1. Check against requirements
      for (const req of reqs) {
        const text = `${req.statement || ''} ${req.statementOriginal || ''}`.toLowerCase();
        if (allKeywords.some((kw) => text.includes(kw))) {
          return {
            ...item,
            status: 'covered',
            matchedRequirementId: req.id,
          };
        }
      }

      // 2. Check against raw segments (mentioned but not yet requirement)
      for (const seg of segs) {
        const text = (seg.text || '').toLowerCase();
        if (allKeywords.some((kw) => text.includes(kw))) {
          return {
            ...item,
            status: 'mentioned',
          };
        }
      }

      // 3. Missing
      return {
        ...item,
        status: 'missing',
      };
    });
  }

  /**
   * PATCH /projects/:id/checklist/:itemId — Mark checklist item as not applicable or unmark.
   */
  async updateChecklistItem(
    projectId: string,
    itemId: string,
    data: { not_applicable: boolean; reason?: string },
  ) {
    const issueId = `iss_chk_${projectId}_${itemId}`;
    const status = data.not_applicable ? 'not_applicable' : 'resolved';
    const reason = data.reason || 'Marked by user';

    const record = {
      id: issueId,
      projectId,
      kind: 'missing',
      ruleId: itemId,
      severity: 'warning',
      status,
      reason,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db
          .insert(issues)
          .values(record)
          .onConflictDoUpdate({ target: issues.id, set: { status, reason } });
      } catch {}
    }
    this.dbService.memIssues.set(issueId, record);

    return {
      projectId,
      itemId,
      status,
      reason,
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
    const runId = crypto.randomUUID();
    const mode = options.mode || 'standard';
    const fromStage = options.from_stage || 1;

    // Estimate token quota: eco=0, standard=5000, thorough=15000
    const estimatedTokens = mode === 'eco' ? 0 : mode === 'thorough' ? 15000 : 5000;

    // Reserve token budget
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
      try {
        await this.dbService.db.insert(runs).values(runRecord);
      } catch {
        this.dbService.memRuns.set(runId, runRecord);
      }
    } else {
      this.dbService.memRuns.set(runId, runRecord);
    }

    // Push to QueuePort
    await this.queue.enqueue({
      type: 'pipeline',
      projectId,
      runId,
      mode,
      fromStage,
    });

    // Notify SSE subscribers
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
      try {
        const found = await this.dbService.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
        if (found.length > 0) run = found[0];
      } catch {}
    }
    if (!run) run = this.dbService.memRuns.get(runId);

    if (!run) throw new NotFoundException(`Run '${runId}' not found`);

    // Check live queue status if queued
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
      try {
        logs = await this.dbService.db.select().from(decisionLog).where(eq(decisionLog.runId, runId));
      } catch {}
    }
    if (logs.length === 0) {
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
      throw new NotFoundException('Insufficient token quota to escalate LLM items');
    }

    // Enqueue single stage LLM escalation
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
   * SSE Stream for Run events.
   */
  getRunEventStream(runId: string) {
    return this.sseService.getEventStream(runId);
  }

  private loadPlatformChecklist(platforms: string[]): PlatformChecklistItem[] {
    const items: PlatformChecklistItem[] = [];

    // Fallback built-in checklist based on Tables in doc lines 1183-1237
    const defaultChecklists: PlatformChecklistItem[] = [
      // Shared
      {
        id: 'shared-backup',
        platform: 'shared',
        topic: { vi: 'Sao lưu và phục hồi', en: 'Backup and recovery' },
        keywords: { vi: ['sao lưu', 'backup', 'phục hồi', 'restore', 'rpo', 'rto'], en: ['backup', 'restore', 'rpo', 'rto'] },
        quality: 'reliability',
        level: 'recommended',
        question: { vi: 'Dữ liệu được sao lưu bao lâu một lần và phục hồi trong bao lâu?', en: 'How often is data backed up and in what timeframe must it be restored?' },
        status: 'missing',
      },
      {
        id: 'shared-audit',
        platform: 'shared',
        topic: { vi: 'Nhật ký kiểm toán', en: 'Audit logs' },
        keywords: { vi: ['nhật ký', 'audit log', 'truy vết'], en: ['audit', 'audit log', 'traceability'] },
        quality: 'security',
        level: 'recommended',
        question: { vi: 'Những thao tác nào phải được ghi lại, lưu trong bao lâu?', en: 'Which operations must be audited and stored for how long?' },
        status: 'missing',
      },
      {
        id: 'shared-privacy',
        platform: 'shared',
        topic: { vi: 'Dữ liệu cá nhân và bảo mật', en: 'Personal data and privacy' },
        keywords: { vi: ['dữ liệu cá nhân', 'quyền riêng tư', 'xoá dữ liệu', 'bảo mật'], en: ['privacy', 'gdpr', 'personal data'] },
        quality: 'security',
        level: 'required',
        question: { vi: 'Hệ thống lưu dữ liệu cá nhân nào và xoá khi nào?', en: 'What personal data is retained and when is it purged?' },
        status: 'missing',
      },
      // Web
      {
        id: 'web-perf',
        platform: 'web',
        topic: { vi: 'Thời gian tải và phản hồi', en: 'Page load and response time' },
        keywords: { vi: ['tải trang', 'thời gian phản hồi', 'lcp', 'ms', 'giây'], en: ['page load', 'latency', 'response time', 'lcp'] },
        quality: 'performance',
        level: 'required',
        question: { vi: 'Thời gian tải trang tối đa là bao nhiêu?', en: 'What is the maximum allowable page load time?' },
        status: 'missing',
      },
      {
        id: 'web-auth',
        platform: 'web',
        topic: { vi: 'Đăng nhập và phiên', en: 'Authentication & Session' },
        keywords: { vi: ['đăng nhập', 'phiên', 'oauth', 'jwt', 'xác thực'], en: ['auth', 'login', 'oauth', 'jwt', 'session'] },
        quality: 'security',
        level: 'required',
        question: { vi: 'Hệ thống xác thực người dùng bằng cách nào?', en: 'How does authentication work?' },
        status: 'missing',
      },
      // Mobile
      {
        id: 'mob-offline',
        platform: 'mobile',
        topic: { vi: 'Ngoại tuyến và đồng bộ', en: 'Offline mode & Sync' },
        keywords: { vi: ['ngoại tuyến', 'offline', 'đồng bộ', 'sync'], en: ['offline', 'sync', 'local cache'] },
        quality: 'reliability',
        level: 'required',
        question: { vi: 'Chức năng nào dùng được ngoại tuyến và đồng bộ thế nào?', en: 'Which functions operate offline and how is data synced?' },
        status: 'missing',
      },
      // IoT
      {
        id: 'iot-protocol',
        platform: 'iot',
        topic: { vi: 'Giao thức giao tiếp thiết bị', en: 'Device communication protocol' },
        keywords: { vi: ['mqtt', 'coap', 'ble', 'lora', 'giao thức'], en: ['mqtt', 'coap', 'ble', 'lora', 'protocol'] },
        quality: 'compatibility',
        level: 'required',
        question: { vi: 'Thiết bị giao tiếp qua giao thức nào?', en: 'Which protocol do devices use?' },
        status: 'missing',
      },
      {
        id: 'iot-ota',
        platform: 'iot',
        topic: { vi: 'Cập nhật firmware từ xa (OTA)', en: 'Firmware Over-The-Air (OTA)' },
        keywords: { vi: ['cập nhật firmware', 'nâng cấp firmware', 'ota'], en: ['firmware', 'ota', 'over-the-air'] },
        quality: 'maintainability',
        level: 'recommended',
        question: { vi: 'Thiết bị cập nhật firmware bằng cách nào?', en: 'How is firmware updated remotely?' },
        status: 'missing',
      },
    ];

    // Filter by platforms selected for project
    return defaultChecklists.filter(
      (item) => item.platform === 'shared' || platforms.includes(item.platform),
    );
  }
}
