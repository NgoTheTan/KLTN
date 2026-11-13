import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { agentSessions, agentPatches } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { ArchitectureService } from '../architecture/architecture.service';
import { CommandParser } from '../architecture/command-parser';
import { RenderPort } from '../../ports';
import { UsageService } from '../usage/usage.service';
import { generateDiagram } from '@srs-tool/plantuml-gen';
import { ModelPatch, PatchOperation, ArchitectureModel, ArchElement, ArchRelationship } from '@srs-tool/schemas';
import * as crypto from 'crypto';

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
   * Create an agent session scoped to a valid `projectId`.
   */
  async createSession(projectId: string, userId: string = '00000000-0000-0000-0000-000000000001') {
    if (!projectId || projectId.trim().length === 0) {
      throw new BadRequestException('projectId is required to create an agent session');
    }

    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      projectId,
      userId,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(agentSessions).values(session);
    } else {
      this.dbService.memAgentSessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * GET /agent/sessions/:id — Get session details and proposed patches.
   */
  async getSession(sessionId: string) {
    const session = await this.findSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Agent session '${sessionId}' not found`);
    }

    let patches: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      patches = await this.dbService.db
        .select()
        .from(agentPatches)
        .where(eq(agentPatches.sessionId, sessionId))
        .orderBy(desc(agentPatches.createdAt));
    } else {
      patches = Array.from(this.dbService.memAgentPatches.values()).filter((p) => p.sessionId === sessionId);
    }

    return {
      ...session,
      patches,
    };
  }

  /**
   * POST /agent/sessions/:id/messages — Process user instruction.
   * - Fixed commands & Tier-0 architectural tactics run deterministically at **0 LLM token cost** (`NFR-LLM-002`).
   * - Crucial invariant (`FR-AGT-003`): Agent NEVER directly modifies the live `ArchitectureModel`; it only proposes `ModelPatch` drafts.
   */
  async sendMessage(sessionId: string, message: string, _userId: string = '00000000-0000-0000-0000-000000000001') {
    if (!message || message.trim().length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    const session = await this.findSession(sessionId);
    if (!session) {
      throw new NotFoundException(
        `Agent session '${sessionId}' not found. Create a session first via POST /api/v1/agent/sessions.`,
      );
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
        0,
      );
    }

    // 2. Deterministic Tier-0 bilingual architectural intent matching (0 LLM tokens consumed!)
    const operations: PatchOperation[] = [];
    const lower = message.toLowerCase();
    const apiId = currentModel.elements.find((e) => e.id === 'api_server' || e.id === 'api')?.id ?? 'api_server';
    let explanation = '';

    if (lower.includes('cache') || lower.includes('redis') || lower.includes('bộ nhớ đệm')) {
      const hasCache = currentModel.elements.some((e: ArchElement) =>
        /cache|redis/i.test(`${e.id} ${e.name} ${e.technology ?? ''}`),
      );
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
            source_id: apiId,
            target_id: 'cache_service',
            label: 'Đọc/ghi cache dữ liệu và rate-limit',
            protocol: 'TCP 6379',
            async: false,
            requirement_ids: [],
          },
        });
        explanation = 'Đề xuất thêm Cache Store (Redis) nối với API Server để giảm tải CSDL và tăng tốc phản hồi.';
      } else {
        explanation = 'Thành phần Cache (Redis) đã tồn tại trong mô hình kiến trúc hiện tại.';
      }
    } else if (
      lower.includes('broker') ||
      lower.includes('queue') ||
      lower.includes('hàng đợi') ||
      lower.includes('kafka') ||
      lower.includes('rabbitmq')
    ) {
      const brokerId = currentModel.elements.some((e) => e.id === 'message_broker')
        ? `message_broker_${Date.now().toString(36).slice(-3)}`
        : 'message_broker';
      operations.push({
        op: 'add_element',
        element: {
          id: brokerId,
          kind: 'container',
          name: 'Message Broker',
          technology: 'RabbitMQ / BullMQ',
          platform: 'shared',
          requirement_ids: [],
        },
      });
      operations.push({
        op: 'add_relationship',
        relationship: {
          id: `rel_api_broker_${Date.now()}`,
          source_id: apiId,
          target_id: brokerId,
          label: 'Đẩy sự kiện và tác vụ bất đồng bộ',
          protocol: 'AMQP / Redis',
          async: true,
          requirement_ids: [],
        },
      });
      explanation = 'Đề xuất thêm Message Broker để tách rời xử lý nền và sự kiện bất đồng bộ.';
    } else if (lower.includes('cdn') || lower.includes('static')) {
      if (!currentModel.elements.some((e) => e.id === 'cdn_edge')) {
        const clientEl = currentModel.elements.find((e) => e.id === 'web_app' || e.id === 'user')?.id ?? apiId;
        operations.push({
          op: 'add_element',
          element: {
            id: 'cdn_edge',
            kind: 'system',
            name: 'Edge CDN',
            technology: 'Cloudflare CDN',
            platform: 'web',
            requirement_ids: [],
          },
        });
        operations.push({
          op: 'add_relationship',
          relationship: {
            id: `rel_cdn_${Date.now()}`,
            source_id: clientEl,
            target_id: 'cdn_edge',
            label: 'Tải tài nguyên tĩnh qua mạng biên',
            protocol: 'HTTPS',
            async: false,
            requirement_ids: [],
          },
        });
        explanation = 'Đề xuất thêm Edge CDN phục vụ tài nguyên tĩnh với độ trễ thấp.';
      } else {
        explanation = 'Edge CDN đã tồn tại trong mô hình.';
      }
    } else if (lower.includes('gateway') || lower.includes('waf') || lower.includes('rate limit')) {
      if (!currentModel.elements.some((e) => e.id === 'api_gateway')) {
        operations.push({
          op: 'add_element',
          element: {
            id: 'api_gateway',
            kind: 'container',
            name: 'API Gateway / WAF',
            technology: 'Nginx / Cloudflare WAF',
            platform: 'shared',
            requirement_ids: [],
          },
        });
        operations.push({
          op: 'add_relationship',
          relationship: {
            id: `rel_gw_api_${Date.now()}`,
            source_id: 'api_gateway',
            target_id: apiId,
            label: 'Chuyển tiếp yêu cầu đã kiểm tra bảo mật & rate-limit',
            protocol: 'HTTPS',
            async: false,
            requirement_ids: [],
          },
        });
        explanation = 'Đề xuất thêm API Gateway / WAF làm lớp bảo vệ biên và giới hạn tốc độ truy cập.';
      } else {
        explanation = 'API Gateway / WAF đã tồn tại trong mô hình.';
      }
    } else if (lower.includes('ota') || lower.includes('firmware')) {
      const iotTarget =
        currentModel.elements.find((e) => e.id === 'iot_device' || e.id === 'iot_gateway' || e.id === 'mqtt_broker')?.id ??
        apiId;
      operations.push({
        op: 'add_element',
        element: {
          id: 'ota_service',
          kind: 'container',
          name: 'OTA Firmware Service',
          technology: 'Node.js Worker',
          platform: 'iot',
          requirement_ids: [],
        },
      });
      operations.push({
        op: 'add_relationship',
        relationship: {
          id: `rel_ota_${Date.now()}`,
          source_id: 'ota_service',
          target_id: iotTarget,
          label: 'Phân phối bản cập nhật firmware an toàn',
          protocol: 'MQTT / HTTPS',
          async: true,
          requirement_ids: [],
        },
      });
      explanation = 'Đề xuất thêm OTA Firmware Service quản lý phát hành và rollback firmware thiết bị IoT.';
    } else {
      explanation =
        `Đã phân tích yêu cầu ở chế độ quy tắc (0 token): "${message}". ` +
        `Bạn có thể dùng cú pháp lệnh trực tiếp ('add element container <tên>', 'rename element <id> to <tên>', 'connect <nguồn> to <đích>', 'change tech of <id> to <tech>') hoặc mô tả chiến thuật (cache, queue/broker, cdn, gateway/waf, ota).`;
    }

    // Tier-0 rule resolution consumes 0 LLM tokens — do NOT charge fake LLM tokens to usage_ledger!
    return this.createDraftPatch(sessionId, currentModel, operations, explanation, 0);
  }

  /**
   * POST /agent/patches/:id/accept — User accepts patch -> applied to actual ArchitectureModel.
   */
  async acceptPatch(patchId: string) {
    let patchRecord: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(agentPatches).where(eq(agentPatches.id, patchId)).limit(1);
      if (found.length > 0) patchRecord = found[0];
    } else {
      patchRecord = this.dbService.memAgentPatches.get(patchId);
    }

    if (!patchRecord) throw new NotFoundException(`Patch '${patchId}' not found`);
    if (patchRecord.status !== 'pending') {
      throw new BadRequestException(`Patch '${patchId}' is already ${patchRecord.status}`);
    }

    const patch: ModelPatch = patchRecord.patch;
    const updatedModel = await this.archService.applyPatch(patchRecord.modelId, patch);

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(agentPatches).set({ status: 'accepted' }).where(eq(agentPatches.id, patchId));
    } else {
      patchRecord.status = 'accepted';
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
      const found = await this.dbService.db.select().from(agentPatches).where(eq(agentPatches.id, patchId)).limit(1);
      if (found.length > 0) patchRecord = found[0];
    } else {
      patchRecord = this.dbService.memAgentPatches.get(patchId);
    }

    if (!patchRecord) throw new NotFoundException(`Patch '${patchId}' not found`);

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.update(agentPatches).set({ status: 'rejected' }).where(eq(agentPatches.id, patchId));
    } else {
      patchRecord.status = 'rejected';
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

    // Apply patch to an isolated draft copy to render preview without touching the active model
    const draftModel: ArchitectureModel = {
      ...currentModel,
      elements: currentModel.elements.map((e) => ({ ...e })),
      relationships: currentModel.relationships.map((r) => ({ ...r })),
    };

    for (const op of operations) {
      if (op.op === 'add_element') {
        draftModel.elements.push(op.element);
      } else if (op.op === 'remove_element') {
        draftModel.elements = draftModel.elements.filter((e: ArchElement) => e.id !== op.element_id);
        draftModel.relationships = draftModel.relationships.filter(
          (r: ArchRelationship) => r.source_id !== op.element_id && r.target_id !== op.element_id,
        );
      } else if (op.op === 'update_element') {
        const el = draftModel.elements.find((e: ArchElement) => e.id === op.element_id);
        if (el) Object.assign(el, op.changes);
      } else if (op.op === 'add_relationship') {
        draftModel.relationships.push(op.relationship);
      } else if (op.op === 'remove_relationship') {
        draftModel.relationships = draftModel.relationships.filter((r) => r.id !== op.relationship_id);
      }
    }

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
      await this.dbService.db.insert(agentPatches).values(patchRecord);
    } else {
      this.dbService.memAgentPatches.set(patchId, patchRecord);
    }

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
      const found = await this.dbService.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .limit(1);
      return found[0];
    }
    return this.dbService.memAgentSessions.get(sessionId);
  }
}
