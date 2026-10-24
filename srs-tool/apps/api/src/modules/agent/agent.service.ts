import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { agentSessions, agentPatches } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ArchitectureService } from '../architecture/architecture.service';
import { CommandParser } from '../architecture/command-parser';
import { RenderPort } from '../../ports';
import { UsageService } from '../usage/usage.service';
import { generateDiagram } from '@srs-tool/plantuml-gen';
import { ModelPatch, PatchOperation, ArchitectureModel, ArchElement } from '@srs-tool/schemas';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly archService: ArchitectureService,
    private readonly usageService: UsageService,
    @Inject('RENDER_PORT') private readonly renderPort: RenderPort,
  ) {}

  /**
   * Create or get an agent session.
   */
  async createSession(projectId: string, userId: string = '00000000-0000-0000-0000-000000000001') {
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      projectId,
      userId,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(agentSessions).values(session);
      } catch {
        this.dbService.memAgentSessions.set(sessionId, session);
      }
    } else {
      this.dbService.memAgentSessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * POST /agent/sessions/:id/messages — Process user instruction.
   * Fixed commands bypass LLM completely (0 token cost).
   * Free-form messages construct a proposed ModelPatch with draft SVG preview.
   * Crucial invariant: Agent NEVER directly modifies the active model; only proposes patches.
   */
  async sendMessage(sessionId: string, message: string, userId: string = '00000000-0000-0000-0000-000000000001') {
    let session = await this.findSession(sessionId);
    if (!session) {
      session = await this.createSession(sessionId, userId);
    }

    const currentModel = await this.archService.findByProject(session.projectId);

    // 1. Try Command Parser first (fixed syntax -> 0 tokens)
    const fixedParse = CommandParser.parse(message);
    if (fixedParse.matched) {
      return this.createDraftPatch(
        sessionId,
        currentModel,
        fixedParse.operations,
        `Fixed command: ${fixedParse.explanation}`,
        0, // 0 LLM tokens
      );
    }

    // 2. Free-form natural language message
    // Parse common architectural intentions (add cache, message broker, auth service, ota, etc.)
    const operations: PatchOperation[] = [];
    const lower = message.toLowerCase();
    let explanation = '';

    if (lower.includes('cache') || lower.includes('redis')) {
      const hasCache = currentModel.elements.some((e: ArchElement) => e.name.toLowerCase().includes('cache'));
      if (!hasCache) {
        operations.push({
          op: 'add_element',
          element: {
            id: 'cache_service',
            kind: 'datastore',
            name: 'Cache Store (Redis)',
            technology: 'Redis 7',
            platform: 'shared',
            requirement_ids: [],
          },
        });
        operations.push({
          op: 'add_relationship',
          relationship: {
            id: `rel_api_cache_${Date.now()}`,
            source_id: 'api_server',
            target_id: 'cache_service',
            label: 'Đọc/ghi cache dữ liệu và rate-limit',
            protocol: 'TCP 6379',
            async: false,
            requirement_ids: [],
          },
        });
        explanation = 'Đề xuất thêm Cache Store (Redis) nối với API Server để giảm tải CSDL và tăng tốc phản hồi.';
      } else {
        explanation = 'Thành phần Cache đã tồn tại trong kiến trúc.';
      }
    } else if (lower.includes('broker') || lower.includes('queue') || lower.includes('kafka') || lower.includes('rabbitmq')) {
      operations.push({
        op: 'add_element',
        element: {
          id: 'message_broker',
          kind: 'container',
          name: 'Message Broker',
          technology: 'RabbitMQ / Apache Kafka',
          platform: 'shared',
          requirement_ids: [],
        },
      });
      operations.push({
        op: 'add_relationship',
        relationship: {
          id: `rel_api_broker_${Date.now()}`,
          source_id: 'api_server',
          target_id: 'message_broker',
          label: 'Đẩy sự kiện bất đồng bộ',
          protocol: 'AMQP',
          async: true,
          requirement_ids: [],
        },
      });
      explanation = 'Đề xuất thêm Message Broker để xử lý các tác vụ xử lý nặng và sự kiện bất đồng bộ.';
    } else if (lower.includes('ota') || lower.includes('firmware')) {
      operations.push({
        op: 'add_element',
        element: {
          id: 'ota_service',
          kind: 'container',
          name: 'OTA Firmware Service',
          technology: 'Go / Node.js Worker',
          platform: 'iot',
          requirement_ids: [],
        },
      });
      operations.push({
        op: 'add_relationship',
        relationship: {
          id: `rel_ota_gateway_${Date.now()}`,
          source_id: 'ota_service',
          target_id: 'iot_gateway',
          label: 'Phân phối bản vá firmware',
          protocol: 'MQTT / HTTPS',
          async: true,
          requirement_ids: [],
        },
      });
      explanation = 'Đề xuất thêm OTA Firmware Service phục vụ quản lý và phân phối cập nhật thiết bị IoT từ xa.';
    } else {
      explanation = `Đã phân tích yêu cầu: "${message}". Không phát hiện thay đổi cấu trúc cần thiết. Bạn có thể sử dụng các lệnh sửa cố định như: 'add element container <tên>', 'rename element <id> to <tên>', 'connect <nguồn> to <đích>'.`;
    }

    // Record token usage if operations were generated via semantic interpretation
    const estimatedTokens = operations.length > 0 ? 350 : 150;
    await this.usageService.record(userId, {
      inputTokens: 120,
      outputTokens: estimatedTokens,
      model: 'gpt-4o-mini',
    });

    return this.createDraftPatch(sessionId, currentModel, operations, explanation, estimatedTokens);
  }

  /**
   * POST /agent/patches/:id/accept — User accepts patch -> applied to actual ArchitectureModel.
   */
  async acceptPatch(patchId: string) {
    let patchRecord: any;
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(agentPatches).where(eq(agentPatches.id, patchId)).limit(1);
        if (found.length > 0) patchRecord = found[0];
      } catch {}
    }
    if (!patchRecord) patchRecord = this.dbService.memAgentPatches.get(patchId);

    if (!patchRecord) throw new NotFoundException(`Patch '${patchId}' not found`);
    if (patchRecord.status !== 'pending') {
      throw new BadRequestException(`Patch '${patchId}' is already ${patchRecord.status}`);
    }

    const patch: ModelPatch = patchRecord.patch;

    // Apply to ArchitectureService
    const updatedModel = await this.archService.applyPatch(patchRecord.modelId, patch);

    // Update patch status
    patchRecord.status = 'accepted';
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.update(agentPatches).set({ status: 'accepted' }).where(eq(agentPatches.id, patchId));
      } catch {}
    }

    this.logger.log(`User accepted patch ${patchId}. Updated model ${patchRecord.modelId} to version ${updatedModel.version}`);
    return {
      patch_id: patchId,
      status: 'accepted',
      model_id: patchRecord.modelId,
      new_version: updatedModel.version,
      model: updatedModel,
    };
  }

  /**
   * POST /agent/patches/:id/reject — User rejects patch.
   */
  async rejectPatch(patchId: string) {
    let patchRecord: any;
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(agentPatches).where(eq(agentPatches.id, patchId)).limit(1);
        if (found.length > 0) patchRecord = found[0];
      } catch {}
    }
    if (!patchRecord) patchRecord = this.dbService.memAgentPatches.get(patchId);

    if (!patchRecord) throw new NotFoundException(`Patch '${patchId}' not found`);

    patchRecord.status = 'rejected';
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.update(agentPatches).set({ status: 'rejected' }).where(eq(agentPatches.id, patchId));
      } catch {}
    }

    this.logger.log(`User rejected patch ${patchId}`);
    return {
      patch_id: patchId,
      status: 'rejected',
    };
  }

  private async createDraftPatch(
    sessionId: string,
    currentModel: ArchitectureModel,
    operations: PatchOperation[],
    explanation: string,
    tokenCost: number,
  ) {
    const patchId = crypto.randomUUID();

    const patch: ModelPatch = {
      operations,
      expected_version: currentModel.version,
      reason: explanation,
    };

    // Apply patch to in-memory draft copy to render preview
    const draftModel: ArchitectureModel = {
      ...currentModel,
      elements: [...currentModel.elements],
      relationships: [...currentModel.relationships],
    };

    for (const op of operations) {
      if (op.op === 'add_element') draftModel.elements.push(op.element);
      else if (op.op === 'remove_element') {
        draftModel.elements = draftModel.elements.filter((e: ArchElement) => e.id !== op.element_id);
      } else if (op.op === 'update_element') {
        const el = draftModel.elements.find((e: ArchElement) => e.id === op.element_id);
        if (el) Object.assign(el, op.changes);
      } else if (op.op === 'add_relationship') draftModel.relationships.push(op.relationship);
    }

    // Generate preview PlantUML and render preview SVG
    const previewPuml = generateDiagram(draftModel, 'container');
    const renderResult = await this.renderPort.render(previewPuml, 'svg');

    const patchRecord = {
      id: patchId,
      sessionId,
      modelId: currentModel.id,
      patch,
      status: 'pending',
      reason: explanation,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(agentPatches).values(patchRecord);
      } catch {}
    }
    this.dbService.memAgentPatches.set(patchId, patchRecord);

    return {
      patch_id: patchId,
      status: 'pending_approval',
      explanation,
      token_cost: tokenCost,
      operations_count: operations.length,
      patch,
      preview_puml: previewPuml,
      preview_svg: renderResult.svg,
    };
  }

  private async findSession(sessionId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).limit(1);
        if (found.length > 0) return found[0];
      } catch {}
    }
    return this.dbService.memAgentSessions.get(sessionId);
  }
}
