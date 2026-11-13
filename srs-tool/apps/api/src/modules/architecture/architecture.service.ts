import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { projects, archModels, diagrams, techRecommendations, requirements } from '../../db/schema';
import { eq, and, ne, desc } from 'drizzle-orm';
import {
  ModelPatch,
  ArchitectureModel,
  ArchElement,
  ArchRelationship,
  TechChoice,
  Language,
  ViewType,
} from '@srs-tool/schemas';
import { loadTechCatalog, loadTacticsCatalog, type TechItem } from '@srs-tool/knowledge';
import { generateDiagram } from '@srs-tool/plantuml-gen';
import { CommandParser } from './command-parser';
import { QueuePort } from '../../ports';
import * as crypto from 'crypto';

@Injectable()
export class ArchitectureService {
  private readonly logger = new Logger(ArchitectureService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Inject('QUEUE_PORT') private readonly queue: QueuePort,
  ) {}

  /**
   * GET /models/:id — Get architecture model.
   */
  async findOne(id: string): Promise<ArchitectureModel> {
    let modelRecord: any;

    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db
        .select()
        .from(archModels)
        .where(eq(archModels.id, id))
        .limit(1);
      if (found.length > 0) modelRecord = found[0];
    } else {
      modelRecord = this.dbService.memArchModels.get(id);
    }

    if (!modelRecord) {
      throw new NotFoundException(`Architecture model '${id}' not found`);
    }

    return {
      id: modelRecord.id,
      project_id: modelRecord.projectId,
      version: modelRecord.version,
      language: (modelRecord.language as Language) || 'vi',
      elements: modelRecord.body?.elements || [],
      relationships: modelRecord.body?.relationships || [],
      views: modelRecord.body?.views || [],
      tech_choices: modelRecord.body?.tech_choices || [],
      created_at: modelRecord.createdAt?.toISOString?.() || new Date().toISOString(),
      updated_at: modelRecord.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  /**
   * GET /projects/:projectId/architecture — Get active model for project (synthesizing v1 if absent).
   */
  async findByProject(projectId: string): Promise<ArchitectureModel> {
    let modelRecord: any;

    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db
        .select()
        .from(archModels)
        .where(eq(archModels.projectId, projectId))
        .orderBy(desc(archModels.version))
        .limit(1);
      if (found.length > 0) modelRecord = found[0];
    } else {
      let bestVersion = -1;
      for (const m of this.dbService.memArchModels.values()) {
        if (m.projectId === projectId && m.version > bestVersion) {
          bestVersion = m.version;
          modelRecord = m;
        }
      }
    }

    if (!modelRecord) {
      return this.synthesizeArchitecture(projectId);
    }

    return this.findOne(modelRecord.id);
  }

  /**
   * GET /projects/:projectId/stack — Get persisted tech stack recommendations.
   */
  async getTechRecommendations(projectId: string) {
    const model = await this.findByProject(projectId);
    if (this.dbService.isConnected && this.dbService.db) {
      const rows = await this.dbService.db
        .select()
        .from(techRecommendations)
        .where(eq(techRecommendations.modelId, model.id));
      if (rows.length > 0) return rows;
    } else {
      const memRows = Array.from(this.dbService.memTechRecommendations.values()).filter(
        (r) => r.modelId === model.id,
      );
      if (memRows.length > 0) return memRows;
    }
    return model.tech_choices;
  }

  /**
   * POST /projects/:projectId/architecture — Knowledge-driven 4-step synthesis (0 LLM tokens):
   * 1. Target system + platform baseline containers (`web`, `mobile`, `iot`)
   * 2. ASR Tactics injection from `tactics-catalog.yaml`
   * 3. Multi-criteria stack scoring from `tech-catalog.yaml` -> `tech_choices` & `tech_recommendations`
   * 4. C4 diagram sync (`context`, `container`, `component` in `model` mode; `detached` preserved)
   */
  async synthesizeArchitecture(projectId: string): Promise<ArchitectureModel> {
    let project: any = null;
    let reqList: any[] = [];
    let existingModel: any = null;

    if (this.dbService.isConnected && this.dbService.db) {
      const projRows = await this.dbService.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      project = projRows[0] ?? null;

      reqList = await this.dbService.db
        .select()
        .from(requirements)
        .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));

      const modelRows = await this.dbService.db
        .select()
        .from(archModels)
        .where(eq(archModels.projectId, projectId))
        .orderBy(desc(archModels.version))
        .limit(1);
      existingModel = modelRows[0] ?? null;
    } else {
      project = this.dbService.memProjects.get(projectId) ?? null;
      reqList = Array.from(this.dbService.memRequirements.values()).filter(
        (r) => r.projectId === projectId && r.status !== 'rejected',
      );
      for (const m of this.dbService.memArchModels.values()) {
        if (m.projectId === projectId && (!existingModel || m.version > existingModel.version)) {
          existingModel = m;
        }
      }
    }

    const lang: Language = (project?.outputLanguage as Language) || 'vi';
    const projectName: string = project?.name || (lang === 'vi' ? 'Hệ thống Phần mềm Mục tiêu' : 'Target Software System');
    const constraints: Record<string, unknown> = (project?.constraints as Record<string, unknown>) || {};

    const platformSet = new Set<string>(project?.platforms?.length ? project.platforms : ['web']);
    for (const r of reqList) {
      for (const p of r.platforms || []) {
        if (p === 'web' || p === 'mobile' || p === 'iot') platformSet.add(p);
      }
    }
    const platforms = Array.from(platformSet);
    const hasWeb = platforms.includes('web');
    const hasMobile = platforms.includes('mobile');
    const hasIoT = platforms.includes('iot');

    const allReqRefs = reqList.map((r) => r.code || r.id);
    const asrReqs = reqList.filter((r) => r.isAsr);
    const asrRefs = asrReqs.map((r) => r.code || r.id);
    const corpus = reqList.map((r) => `${r.statement || ''} ${r.statementOriginal || ''}`).join('\n');

    // Load curated YAML catalogs
    const techCatalog = loadTechCatalog();
    const tacticsCatalog = loadTacticsCatalog();
    const qualityWeights = this.deriveQualityWeights(reqList, constraints);

    const pickBestTech = (layer: string): TechItem | undefined => {
      const candidates = techCatalog.entries.filter((item) => {
        if (item.layer !== layer) return false;
        if (constraints['open_source_only'] === true && /proprietary|commercial/i.test(item.license)) {
          return false;
        }
        return true;
      });
      if (candidates.length === 0) return undefined;

      const platformFiltered = candidates.filter((item) =>
        item.platforms.some((p) => platforms.includes(p) || p === 'shared'),
      );
      const pool = platformFiltered.length > 0 ? platformFiltered : candidates;

      return [...pool].sort((a, b) => this.scoreTechItem(b, qualityWeights) - this.scoreTechItem(a, qualityWeights))[0];
    };

    const elements: ArchElement[] = [];
    const relationships: ArchRelationship[] = [];

    const addEl = (el: ArchElement) => {
      if (!elements.some((e) => e.id === el.id)) {
        elements.push(el);
      }
    };
    const addRel = (rel: ArchRelationship) => {
      if (
        elements.some((e) => e.id === rel.source_id) &&
        elements.some((e) => e.id === rel.target_id) &&
        !relationships.some(
          (r) => r.source_id === rel.source_id && r.target_id === rel.target_id && r.label === rel.label,
        )
      ) {
        relationships.push(rel);
      }
    };

    // Step 1: Central Target System + Primary Actor + Platform Containers
    addEl({
      id: 'target_system',
      kind: 'system',
      name: projectName,
      description:
        lang === 'vi'
          ? 'Hệ thống phần mềm mục tiêu cần phát triển'
          : 'Target software system under specification',
      requirement_ids: allReqRefs.slice(0, 12),
    });

    addEl({
      id: 'user',
      kind: 'person',
      name: lang === 'vi' ? 'Người dùng' : 'End User',
      description:
        lang === 'vi'
          ? 'Người dùng tương tác với hệ thống qua giao diện'
          : 'Primary actor interacting with the system',
      requirement_ids: [],
    });

    const feTech = pickBestTech('frontend');
    const mobTech = pickBestTech('mobile');
    const beTech = pickBestTech('backend');
    const dbTech = pickBestTech('database');
    const cacheTech = pickBestTech('cache');
    const brokerTech = pickBestTech('broker');

    if (hasWeb || (!hasMobile && !hasIoT)) {
      addEl({
        id: 'web_app',
        kind: 'container',
        name: 'Web Application (SPA)',
        technology: feTech?.name ?? 'React + TypeScript + Vite',
        description: lang === 'vi' ? 'Ứng dụng giao diện Web SPA' : 'Single-page web client application',
        platform: 'web',
        requirement_ids: reqList.filter((r) => r.platforms?.includes('web')).map((r) => r.code || r.id),
      });
    }

    if (hasMobile) {
      addEl({
        id: 'mobile_app',
        kind: 'container',
        name: 'Mobile Application',
        technology: mobTech?.name ?? 'React Native (Expo)',
        description: lang === 'vi' ? 'Ứng dụng di động đa nền tảng' : 'Cross-platform mobile application',
        platform: 'mobile',
        requirement_ids: reqList.filter((r) => r.platforms?.includes('mobile')).map((r) => r.code || r.id),
      });
    }

    addEl({
      id: 'api_server',
      kind: 'container',
      name: 'API Server',
      technology: beTech?.name ?? 'NestJS (TypeScript)',
      description: lang === 'vi' ? ' Xử lý nghiệp vụ trung tâm, xác thực và REST/SSE API'.trim() : 'Core business logic, auth, and REST/SSE API',
      platform: 'shared',
      requirement_ids: asrRefs.length > 0 ? asrRefs : allReqRefs.slice(0, 8),
    });

    addEl({
      id: 'database',
      kind: 'datastore',
      name: 'Primary Database',
      technology: dbTech?.name ?? 'PostgreSQL + pgvector',
      description: lang === 'vi' ? 'Lưu trữ dữ liệu quan hệ, JSON và vector' : 'Relational, JSON, and vector storage',
      platform: 'shared',
      requirement_ids: asrRefs,
    });

    addEl({
      id: 'cache_redis',
      kind: 'datastore',
      name: 'Cache & Queue Store',
      technology: cacheTech?.name ?? 'Redis',
      description: lang === 'vi' ? 'Bộ nhớ đệm phiên, rate-limit và hàng đợi tác vụ' : 'In-memory session cache, rate-limit, and queue store',
      platform: 'shared',
      requirement_ids: [],
    });

    if (hasIoT) {
      addEl({
        id: 'iot_device',
        kind: 'device',
        name: lang === 'vi' ? 'Thiết bị IoT / Cảm biến' : 'IoT Edge Device / Sensor',
        technology: 'MCU / Embedded TLS',
        description: lang === 'vi' ? 'Thiết bị biên thu thập dữ liệu cảm biến' : 'Edge device publishing telemetry',
        platform: 'iot',
        requirement_ids: reqList.filter((r) => r.platforms?.includes('iot')).map((r) => r.code || r.id),
      });
      addEl({
        id: 'mqtt_broker',
        kind: 'container',
        name: 'MQTT Broker',
        technology: brokerTech?.name ?? 'EMQX',
        description: lang === 'vi' ? 'Bộ điều phối bản tin MQTT cho thiết bị IoT' : 'MQTT telemetry broker for IoT fleet',
        platform: 'iot',
        requirement_ids: reqList.filter((r) => r.platforms?.includes('iot')).map((r) => r.code || r.id),
      });
    }

    // Baseline relationships
    if (elements.some((e) => e.id === 'web_app')) {
      addRel({
        id: 'rel_user_web',
        source_id: 'user',
        target_id: 'web_app',
        label: lang === 'vi' ? 'Tương tác qua HTTPS' : 'Interacts over HTTPS',
        protocol: 'HTTPS',
        async: false,
        requirement_ids: [],
      });
      addRel({
        id: 'rel_web_api',
        source_id: 'web_app',
        target_id: 'api_server',
        label: lang === 'vi' ? 'Gọi REST API & nhận SSE' : 'Calls REST API & SSE',
        protocol: 'HTTPS / SSE',
        async: false,
        requirement_ids: [],
      });
    }

    if (elements.some((e) => e.id === 'mobile_app')) {
      addRel({
        id: 'rel_user_mobile',
        source_id: 'user',
        target_id: 'mobile_app',
        label: lang === 'vi' ? 'Sử dụng ứng dụng di động' : 'Uses mobile app',
        protocol: 'HTTPS',
        async: false,
        requirement_ids: [],
      });
      addRel({
        id: 'rel_mobile_api',
        source_id: 'mobile_app',
        target_id: 'api_server',
        label: lang === 'vi' ? 'Đồng bộ & gọi REST API' : 'Syncs & calls REST API',
        protocol: 'HTTPS',
        async: false,
        requirement_ids: [],
      });
    }

    addRel({
      id: 'rel_api_db',
      source_id: 'api_server',
      target_id: 'database',
      label: lang === 'vi' ? 'Đọc/ghi dữ liệu nghiệp vụ' : 'Reads/writes domain data',
      protocol: 'TCP 5432',
      async: false,
      requirement_ids: [],
    });

    addRel({
      id: 'rel_api_redis',
      source_id: 'api_server',
      target_id: 'cache_redis',
      label: lang === 'vi' ? 'Cache & đưa job hàng đợi' : 'Caches & enqueues background jobs',
      protocol: 'TCP 6379',
      async: false,
      requirement_ids: [],
    });

    if (hasIoT) {
      addRel({
        id: 'rel_iot_broker',
        source_id: 'iot_device',
        target_id: 'mqtt_broker',
        label: lang === 'vi' ? 'Gửi telemetry cảm biến' : 'Publishes sensor telemetry',
        protocol: 'MQTT / TLS',
        async: true,
        requirement_ids: [],
      });
      addRel({
        id: 'rel_broker_api',
        source_id: 'mqtt_broker',
        target_id: 'api_server',
        label: lang === 'vi' ? 'Chuyển tiếp sự kiện thiết bị' : 'Forwards device events',
        protocol: 'MQTT / Webhook',
        async: true,
        requirement_ids: [],
      });
    }

    // Step 2: Apply ASR Tactics from tactics-catalog.yaml
    const aliasMap: Record<string, string> = {
      api: 'api_server',
      browser: elements.some((e) => e.id === 'web_app') ? 'web_app' : 'user',
      device: 'iot_device',
      broker: 'mqtt_broker',
      cache: 'cache_redis',
      queue: 'message_queue',
      worker: 'worker',
      waf: 'api_gateway_waf',
      cdn: 'cdn',
      ingestion: 'ingestion_service',
      tsdb: 'time_series_db',
      'ota-service': 'ota_service',
    };

    for (const tactic of tacticsCatalog.tactics) {
      if (tactic.when.platform && !platforms.includes(tactic.when.platform)) continue;
      const matched = (tactic.when.keywords ?? []).some((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i').test(corpus);
      });
      if (!matched) continue;

      const addedIds: string[] = [];
      for (const spec of tactic.add?.elements ?? []) {
        const normalizedId = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        // Skip duplicate cache/broker if baseline already provides them
        if (normalizedId === 'cache' && elements.some((e) => e.id === 'cache_redis')) continue;
        if (normalizedId === 'mqtt_broker' && elements.some((e) => e.id === 'mqtt_broker')) continue;

        addEl({
          id: normalizedId,
          kind: spec.kind,
          name: spec.name,
          technology: spec.technology,
          description: spec.description,
          platform: (tactic.when.platform as any) || 'shared',
          requirement_ids: asrRefs,
        });
        addedIds.push(normalizedId);
      }

      let linkedExplicitly = false;
      for (const rSpec of tactic.add?.relationships ?? []) {
        const src = aliasMap[rSpec.source] ?? rSpec.source.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const dst = aliasMap[rSpec.target] ?? rSpec.target.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (elements.some((e) => e.id === src) && elements.some((e) => e.id === dst)) {
          addRel({
            id: `rel_${src}_${dst}`,
            source_id: src,
            target_id: dst,
            label: rSpec.label || 'connects to',
            protocol: rSpec.protocol,
            async: /queue|mqtt|async/i.test(`${rSpec.label ?? ''} ${rSpec.protocol ?? ''}`),
            requirement_ids: asrRefs,
          });
          linkedExplicitly = true;
        }
      }

      if (!linkedExplicitly) {
        for (const addedId of addedIds) {
          if (addedId !== 'api_server') {
            addRel({
              id: `rel_api_${addedId}`,
              source_id: 'api_server',
              target_id: addedId,
              label: tactic.rationale.slice(0, 48),
              requirement_ids: asrRefs,
            });
          }
        }
      }
    }

    // Step 3: Build Scored Tech Stack Choices from tech-catalog.yaml
    const candidateLayers = [
      ...(hasWeb || (!hasMobile && !hasIoT) ? ['frontend'] : []),
      ...(hasMobile ? ['mobile'] : []),
      'backend',
      'database',
      'cache',
      'queue',
      ...(hasIoT ? ['broker'] : []),
      'storage',
      'auth',
    ];

    const techChoices: TechChoice[] = [];
    for (const layer of candidateLayers) {
      const chosen = pickBestTech(layer);
      if (!chosen) continue;
      const rationaleText =
        typeof chosen.tradeoffs === 'string' && chosen.tradeoffs.trim().length > 0
          ? chosen.tradeoffs.trim()
          : `${chosen.name} (${chosen.license}, maturity: ${chosen.maturity})`;
      techChoices.push({
        layer,
        choice: chosen.name,
        alternatives: chosen.alternatives,
        rationale: rationaleText,
        requirement_ids: asrRefs,
      });
    }

    const views = [
      { id: 'view_context', type: 'context' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
      { id: 'view_container', type: 'container' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
      { id: 'view_component', type: 'component' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
    ];

    const modelId = existingModel?.id ?? crypto.randomUUID();
    const nextVersion = existingModel ? existingModel.version + 1 : 1;
    const now = new Date();

    const body = {
      elements,
      relationships,
      views,
      tech_choices: techChoices,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      if (existingModel) {
        await this.dbService.db
          .update(archModels)
          .set({ version: nextVersion, language: lang, body, updatedAt: now })
          .where(eq(archModels.id, modelId));
        await this.dbService.db.delete(techRecommendations).where(eq(techRecommendations.modelId, modelId));
      } else {
        await this.dbService.db.insert(archModels).values({
          id: modelId,
          projectId,
          version: nextVersion,
          language: lang,
          body,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (techChoices.length > 0) {
        await this.dbService.db.insert(techRecommendations).values(
          techChoices.map((tc) => ({
            id: crypto.randomUUID(),
            modelId,
            layer: tc.layer,
            choice: tc.choice,
            alternatives: tc.alternatives,
            rationale: tc.rationale,
            createdAt: now,
          })),
        );
      }
    } else {
      this.dbService.memArchModels.set(modelId, {
        id: modelId,
        projectId,
        version: nextVersion,
        language: lang,
        body,
        createdAt: existingModel?.createdAt ?? now,
        updatedAt: now,
      });

      for (const [k, rec] of this.dbService.memTechRecommendations.entries()) {
        if (rec.modelId === modelId) this.dbService.memTechRecommendations.delete(k);
      }
      for (const tc of techChoices) {
        const recId = crypto.randomUUID();
        this.dbService.memTechRecommendations.set(recId, {
          id: recId,
          modelId,
          layer: tc.layer,
          choice: tc.choice,
          alternatives: tc.alternatives,
          rationale: tc.rationale,
          createdAt: now,
        });
      }
    }

    const synthesized = await this.findOne(modelId);
    // Step 4: Synchronize C4 diagrams in 'model' mode (preserving 'detached' edits)
    await this.syncDiagramsForModel(synthesized);

    this.logger.log(
      `Synthesized architecture model ${modelId} v${nextVersion} for project ${projectId} (elements=${elements.length}, stack=${techChoices.length})`,
    );
    return synthesized;
  }

  /**
   * PATCH /models/:id — Apply a ModelPatch with optimistic concurrency (expected_version).
   */
  async applyPatch(modelId: string, patch: ModelPatch): Promise<ArchitectureModel> {
    const current = await this.findOne(modelId);

    if (patch.expected_version !== undefined && patch.expected_version !== current.version) {
      throw new ConflictException(
        `Version conflict: expected version ${patch.expected_version}, but model is at version ${current.version}`,
      );
    }

    const nextElements = current.elements.map((e) => ({ ...e }));
    let nextRelationships = current.relationships.map((r) => ({ ...r }));
    const nextTechChoices = current.tech_choices.map((t) => ({ ...t }));

    for (const op of patch.operations) {
      switch (op.op) {
        case 'add_element': {
          if (nextElements.some((e) => e.id === op.element.id)) {
            throw new BadRequestException(`Element with ID '${op.element.id}' already exists`);
          }
          nextElements.push(op.element);
          break;
        }
        case 'remove_element': {
          const idx = nextElements.findIndex((e) => e.id === op.element_id);
          if (idx >= 0) nextElements.splice(idx, 1);
          // Prevent dangling relationships
          nextRelationships = nextRelationships.filter(
            (rel) => rel.source_id !== op.element_id && rel.target_id !== op.element_id,
          );
          break;
        }
        case 'update_element': {
          const el = nextElements.find((e) => e.id === op.element_id);
          if (!el) throw new NotFoundException(`Element '${op.element_id}' not found`);
          Object.assign(el, op.changes);
          break;
        }
        case 'add_relationship': {
          const hasSource = nextElements.some((e) => e.id === op.relationship.source_id);
          const hasTarget = nextElements.some((e) => e.id === op.relationship.target_id);
          if (!hasSource || !hasTarget) {
            throw new BadRequestException(
              `Cannot connect: source '${op.relationship.source_id}' or target '${op.relationship.target_id}' does not exist`,
            );
          }
          nextRelationships.push(op.relationship);
          break;
        }
        case 'remove_relationship': {
          const rIdx = nextRelationships.findIndex((r) => r.id === op.relationship_id);
          if (rIdx >= 0) nextRelationships.splice(rIdx, 1);
          break;
        }
        case 'add_tech_choice': {
          nextTechChoices.push(op.tech_choice);
          break;
        }
      }
    }

    const nextVersion = current.version + 1;
    const now = new Date();
    const updatedBody = {
      elements: nextElements,
      relationships: nextRelationships,
      views: current.views,
      tech_choices: nextTechChoices,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .update(archModels)
        .set({
          version: nextVersion,
          body: updatedBody,
          updatedAt: now,
        })
        .where(eq(archModels.id, modelId));
    } else {
      const mem = this.dbService.memArchModels.get(modelId);
      if (mem) {
        mem.version = nextVersion;
        mem.body = updatedBody;
        mem.updatedAt = now;
      }
    }

    const updatedModel = await this.findOne(modelId);
    await this.syncDiagramsForModel(updatedModel);

    this.logger.log(`Applied patch to model ${modelId} -> version ${nextVersion}`);
    return updatedModel;
  }

  /**
   * POST /models/:id/commands — Execute fixed-syntax command (no LLM, 0 token cost).
   */
  async executeCommand(modelId: string, command: string) {
    const parseResult = CommandParser.parse(command);

    if (!parseResult.matched) {
      throw new BadRequestException(
        `Command '${command}' is not a supported fixed command syntax. Supported patterns: ` +
          `'rename element <id> to <name>', 'add element <kind> <name>', 'remove element <id>', ` +
          `'connect <source> to <target> [label <label>]', 'change tech of <id> to <tech>'`,
      );
    }

    const current = await this.findOne(modelId);
    const updatedModel = await this.applyPatch(modelId, {
      operations: parseResult.operations,
      expected_version: current.version,
      reason: parseResult.explanation,
    });

    return {
      command,
      command_type: parseResult.commandType,
      explanation: parseResult.explanation,
      model: updatedModel,
      version: updatedModel.version,
    };
  }

  /**
   * Synchronizes `context`, `container`, and `component` PlantUML diagrams in `model` mode.
   * Diagrams in `detached` mode are intentionally left untouched (`FR-ARCH-006`).
   */
  async syncDiagramsForModel(model: ArchitectureModel): Promise<void> {
    const viewTypes: ViewType[] = ['context', 'container', 'component'];
    const now = new Date();

    for (const viewType of viewTypes) {
      const puml = generateDiagram(model, viewType);

      if (this.dbService.isConnected && this.dbService.db) {
        const existing = await this.dbService.db
          .select()
          .from(diagrams)
          .where(and(eq(diagrams.modelId, model.id), eq(diagrams.type, viewType)))
          .limit(1);

        if (existing.length === 0) {
          await this.dbService.db.insert(diagrams).values({
            id: crypto.randomUUID(),
            modelId: model.id,
            type: viewType,
            mode: 'model',
            puml,
            svgS3Key: null,
            createdAt: now,
            updatedAt: now,
          });
        } else if (existing[0]!.mode === 'model') {
          await this.dbService.db
            .update(diagrams)
            .set({ puml, updatedAt: now })
            .where(eq(diagrams.id, existing[0]!.id));
        }
      } else {
        let matched: any = null;
        for (const d of this.dbService.memDiagrams.values()) {
          if (d.modelId === model.id && d.type === viewType) {
            matched = d;
            break;
          }
        }
        if (!matched) {
          const id = crypto.randomUUID();
          this.dbService.memDiagrams.set(id, {
            id,
            modelId: model.id,
            type: viewType,
            mode: 'model',
            puml,
            svgS3Key: null,
            createdAt: now,
            updatedAt: now,
          });
        } else if (matched.mode === 'model') {
          matched.puml = puml;
          matched.updatedAt = now;
        }
      }
    }
  }

  private deriveQualityWeights(reqs: any[], constraints: Record<string, unknown>): Record<string, number> {
    const weights: Record<string, number> = {
      performance: 1,
      scalability: 1,
      reliability: 1,
      security: 1,
      maintainability: 1,
      ecosystem: 1,
      simplicity: constraints['small_team'] ? 2 : 1,
      cost: constraints['low_budget'] ? 2 : 1,
    };

    for (const r of reqs) {
      const text = `${r.statement || ''} ${r.statementOriginal || ''}`.toLowerCase();
      if (/latency|response time|ms|thời gian phản hồi|tải trang/.test(text)) weights['performance']! += 0.5;
      if (/scale|concurrent|đồng thời|mở rộng/.test(text)) weights['scalability']! += 0.5;
      if (/uptime|backup|recovery|offline|phục hồi/.test(text)) weights['reliability']! += 0.5;
      if (/oauth|jwt|encrypt|audit|bảo mật|xác thực/.test(text)) weights['security']! += 0.5;
    }

    return weights;
  }

  private scoreTechItem(item: TechItem, weights: Record<string, number>): number {
    let total = 0;
    for (const [criterion, score] of Object.entries(item.scores || {})) {
      const w = weights[criterion] ?? 1;
      total += Number(score || 0) * w;
    }
    if (item.maturity === 'high' || item.maturity === 'proven') total += 1;
    return total;
  }
}
