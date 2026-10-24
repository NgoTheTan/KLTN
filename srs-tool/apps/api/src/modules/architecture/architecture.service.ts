import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { archModels, diagrams, techRecommendations, requirements } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { ModelPatch, ArchitectureModel, ArchElement, ArchRelationship } from '@srs-tool/schemas';
import { CommandParser } from './command-parser';
import { QueuePort } from '../../ports';

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
      try {
        const found = await this.dbService.db
          .select()
          .from(archModels)
          .where(eq(archModels.id, id))
          .limit(1);
        if (found.length > 0) modelRecord = found[0];
      } catch {}
    }

    if (!modelRecord) {
      modelRecord = this.dbService.memArchModels.get(id);
    }

    if (!modelRecord) {
      throw new NotFoundException(`Architecture model '${id}' not found`);
    }

    return {
      id: modelRecord.id,
      project_id: modelRecord.projectId,
      version: modelRecord.version,
      language: (modelRecord.language as any) || 'vi',
      elements: modelRecord.body?.elements || [],
      relationships: modelRecord.body?.relationships || [],
      views: modelRecord.body?.views || [],
      tech_choices: modelRecord.body?.tech_choices || [],
      created_at: modelRecord.createdAt?.toISOString?.() || new Date().toISOString(),
      updated_at: modelRecord.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  /**
   * GET /projects/:projectId/model — Get active model for project.
   */
  async findByProject(projectId: string): Promise<ArchitectureModel> {
    let modelRecord: any;

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db
          .select()
          .from(archModels)
          .where(eq(archModels.projectId, projectId))
          .orderBy(desc(archModels.version))
          .limit(1);
        if (found.length > 0) modelRecord = found[0];
      } catch {}
    }

    if (!modelRecord) {
      for (const m of this.dbService.memArchModels.values()) {
        if (m.projectId === projectId) {
          modelRecord = m;
          break;
        }
      }
    }

    if (!modelRecord) {
      // Auto-synthesize default model if none exists
      return this.synthesizeArchitecture(projectId);
    }

    return this.findOne(modelRecord.id);
  }

  /**
   * POST /projects/:projectId/architecture — Synthesize architecture model from requirements.
   * Deterministic pattern synthesis based on ASRs and reference templates (no LLM required).
   */
  async synthesizeArchitecture(projectId: string): Promise<ArchitectureModel> {
    const modelId = crypto.randomUUID();

    // Query project requirements to find ASRs and platforms
    let reqList: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        reqList = await this.dbService.db
          .select()
          .from(requirements)
          .where(eq(requirements.projectId, projectId));
      } catch {}
    } else {
      reqList = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
    }

    const asrReqs = reqList.filter((r) => r.isAsr);
    const hasIoT = reqList.some((r) => r.platforms?.includes('iot'));
    const hasMobile = reqList.some((r) => r.platforms?.includes('mobile'));

    const elements: ArchElement[] = [
      {
        id: 'user',
        kind: 'person',
        name: 'Người dùng',
        description: 'Người dùng tương tác qua giao diện web/app',
        requirement_ids: [],
      },
      {
        id: 'web_app',
        kind: 'container',
        name: 'Web Application (SPA)',
        technology: 'React + TypeScript + Vite',
        platform: 'web',
        requirement_ids: [],
      },
      {
        id: 'api_server',
        kind: 'container',
        name: 'API Server',
        technology: 'NestJS (Node.js)',
        platform: 'shared',
        requirement_ids: asrReqs.map((r) => r.id),
      },
      {
        id: 'database',
        kind: 'datastore',
        name: 'Primary Database',
        technology: 'PostgreSQL + pgvector',
        platform: 'shared',
        requirement_ids: [],
      },
      {
        id: 'cache_redis',
        kind: 'datastore',
        name: 'Cache & Queue Store',
        technology: 'Redis 7',
        platform: 'shared',
        requirement_ids: [],
      },
    ];

    if (hasMobile) {
      elements.push({
        id: 'mobile_app',
        kind: 'container',
        name: 'Mobile Application',
        technology: 'React Native / Flutter',
        platform: 'mobile',
        requirement_ids: [],
      });
    }

    if (hasIoT) {
      elements.push({
        id: 'iot_gateway',
        kind: 'device',
        name: 'IoT Edge Gateway / Broker',
        technology: 'EMQX (MQTT)',
        platform: 'iot',
        requirement_ids: [],
      });
    }

    const relationships: ArchRelationship[] = [
      {
        id: 'rel_user_web',
        source_id: 'user',
        target_id: 'web_app',
        label: 'Tương tác qua HTTPS',
        protocol: 'HTTPS',
        async: false,
        requirement_ids: [],
      },
      {
        id: 'rel_web_api',
        source_id: 'web_app',
        target_id: 'api_server',
        label: 'Gọi REST API và nhận sự kiện SSE',
        protocol: 'REST / SSE',
        async: false,
        requirement_ids: [],
      },
      {
        id: 'rel_api_db',
        source_id: 'api_server',
        target_id: 'database',
        label: 'Đọc/ghi dữ liệu nghiệp vụ và vector',
        protocol: 'TCP 5432',
        async: false,
        requirement_ids: [],
      },
      {
        id: 'rel_api_redis',
        source_id: 'api_server',
        target_id: 'cache_redis',
        label: 'Cache phiên, rate-limit và đưa job hàng đợi',
        protocol: 'TCP 6379',
        async: false,
        requirement_ids: [],
      },
    ];

    if (hasMobile) {
      relationships.push({
        id: 'rel_user_mobile',
        source_id: 'user',
        target_id: 'mobile_app',
        label: 'Sử dụng app',
        async: false,
        requirement_ids: [],
      });
      relationships.push({
        id: 'rel_mobile_api',
        source_id: 'mobile_app',
        target_id: 'api_server',
        label: 'Đồng bộ dữ liệu và gọi REST API',
        protocol: 'HTTPS',
        async: false,
        requirement_ids: [],
      });
    }

    if (hasIoT) {
      relationships.push({
        id: 'rel_iot_api',
        source_id: 'iot_gateway',
        target_id: 'api_server',
        label: 'Chuyển tiếp bản tin cảm biến',
        protocol: 'MQTT / Webhook',
        async: true,
        requirement_ids: [],
      });
    }

    const views = [
      { id: 'view_context', type: 'context' as const, include_ids: ['user', 'web_app', 'api_server'], mode: 'model' as const },
      { id: 'view_container', type: 'container' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
    ];

    const techChoices = [
      {
        layer: 'Frontend',
        choice: 'React + TypeScript',
        alternatives: ['Vue.js', 'Next.js'],
        rationale: 'Hệ sinh thái phong phú, dễ dàng tích hợp trình hiển thị đồ họa SVG và CodeMirror.',
        requirement_ids: [],
      },
      {
        layer: 'Backend',
        choice: 'NestJS (TypeScript)',
        alternatives: ['Fastify', 'Express', 'Spring Boot'],
        rationale: 'Kiến trúc Modular Monolith rõ ràng, dễ tách worker và bảo trì DI.',
        requirement_ids: [],
      },
      {
        layer: 'Database',
        choice: 'PostgreSQL + pgvector',
        alternatives: ['MySQL', 'MongoDB'],
        rationale: 'Một hệ quản trị CSDL duy nhất cho cả quan hệ, JSON và vector embedding.',
        requirement_ids: [],
      },
    ];

    const modelRecord = {
      id: modelId,
      projectId,
      version: 1,
      language: 'vi',
      body: {
        elements,
        relationships,
        views,
        tech_choices: techChoices,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(archModels).values(modelRecord);
      } catch {
        this.dbService.memArchModels.set(modelId, modelRecord);
      }
    } else {
      this.dbService.memArchModels.set(modelId, modelRecord);
    }

    this.logger.log(`Synthesized architecture model ${modelId} for project ${projectId} (elements: ${elements.length})`);
    return this.findOne(modelId);
  }

  /**
   * PATCH /models/:id — Apply a ModelPatch with optimistic concurrency (expected_version).
   */
  async applyPatch(modelId: string, patch: ModelPatch): Promise<ArchitectureModel> {
    const current = await this.findOne(modelId);

    // Optimistic concurrency check (doc line 699: "khoá lạc quan if_version")
    if (patch.expected_version !== undefined && patch.expected_version !== current.version) {
      throw new ConflictException(
        `Version conflict: expected version ${patch.expected_version}, but model is at version ${current.version}`,
      );
    }

    const nextElements = [...current.elements];
    let nextRelationships = [...current.relationships];
    const nextTechChoices = [...current.tech_choices];

    // Apply operations
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
          // Prevent dangling relationships (doc line 686: "không có quan hệ treo")
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
          // Verify source and target exist
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
    const updatedBody = {
      elements: nextElements,
      relationships: nextRelationships,
      views: current.views,
      tech_choices: nextTechChoices,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db
          .update(archModels)
          .set({
            version: nextVersion,
            body: updatedBody,
            updatedAt: new Date(),
          })
          .where(eq(archModels.id, modelId));
      } catch {}
    }

    const mem = this.dbService.memArchModels.get(modelId);
    if (mem) {
      mem.version = nextVersion;
      mem.body = updatedBody;
      mem.updatedAt = new Date();
    }

    this.logger.log(`Applied patch to model ${modelId} -> version ${nextVersion}`);
    return this.findOne(modelId);
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
}
