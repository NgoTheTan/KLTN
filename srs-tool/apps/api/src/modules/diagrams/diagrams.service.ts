import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { diagrams } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { RenderPort } from '../../ports';
import { ArchitectureService } from '../architecture/architecture.service';
import { generateDiagram, validateSafePuml } from '@srs-tool/plantuml-gen';
import { ArchitectureModel, ViewType } from '@srs-tool/schemas';
import * as crypto from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DiagramsService {
  private readonly logger = new Logger(DiagramsService.name);
  private readonly svgCache = new Map<string, string>();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly archService: ArchitectureService,
    @Inject('RENDER_PORT') private readonly renderPort: RenderPort,
  ) {}

  /**
   * Get diagram by ID and format (`svg`, `png`, `puml`, `json`).
   */
  async getDiagram(id: string, format: 'svg' | 'png' | 'puml' | 'json' = 'svg') {
    let diagramRecord = await this.findDiagramRecord(id);

    // If 'id' is a modelId, resolve its default 'container' view
    if (!diagramRecord) {
      diagramRecord = await this.getOrCreateDiagramForModel(id, 'container');
    }

    let pumlSource: string = diagramRecord.puml;

    // In 'model' mode, regenerate PlantUML from ArchitectureModel so it is always synchronized
    if (diagramRecord.mode === 'model') {
      const model = await this.archService.findOne(diagramRecord.modelId);
      const viewType = (diagramRecord.type as ViewType) || 'container';
      pumlSource = generateDiagram(model, viewType);
      diagramRecord.puml = pumlSource;
    }

    if (format === 'puml') {
      return {
        id: diagramRecord.id,
        modelId: diagramRecord.modelId,
        format: 'puml',
        mode: diagramRecord.mode,
        type: diagramRecord.type,
        content: pumlSource,
        puml: pumlSource,
      };
    }

    const renderFmt = format === 'png' ? 'png' : 'svg';
    const shaHash = crypto.createHash('sha1').update(pumlSource).digest('hex');
    const cacheKey = `${diagramRecord.id}_${shaHash}_${renderFmt}`;

    if (renderFmt === 'svg' && this.svgCache.has(cacheKey)) {
      return {
        id: diagramRecord.id,
        modelId: diagramRecord.modelId,
        format,
        mode: diagramRecord.mode,
        type: diagramRecord.type,
        svg: this.svgCache.get(cacheKey),
        puml: pumlSource,
      };
    }

    const renderResult = await this.renderPort.render(pumlSource, renderFmt);

    if (renderFmt === 'svg' && renderResult.svg && !renderResult.error) {
      this.svgCache.set(cacheKey, renderResult.svg);
    }

    return {
      id: diagramRecord.id,
      modelId: diagramRecord.modelId,
      format,
      mode: diagramRecord.mode,
      type: diagramRecord.type,
      svg: renderResult.svg,
      png: renderResult.png,
      error: renderResult.error,
      puml: pumlSource,
    };
  }

  /**
   * Update PlantUML source in detached mode (user-edited custom PlantUML).
   * Enforces `validateSafePuml` (`NFR-SEC-004`) to prevent SSRF / local file inclusion via `!include`.
   */
  async updatePuml(diagramId: string, puml: string) {
    if (typeof puml !== 'string' || puml.trim().length === 0) {
      throw new BadRequestException('PlantUML source cannot be empty');
    }

    const safety = validateSafePuml(puml);
    if (!safety.valid) {
      throw new BadRequestException(safety.reason || 'Unsafe PlantUML directive blocked');
    }

    const record = await this.findDiagramRecord(diagramId);
    if (!record) throw new NotFoundException(`Diagram '${diagramId}' not found`);

    const now = new Date();
    const updated = {
      ...record,
      puml,
      mode: 'detached',
      updatedAt: now,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .update(diagrams)
        .set({ puml, mode: 'detached', updatedAt: now })
        .where(eq(diagrams.id, record.id));
    } else {
      this.dbService.memDiagrams.set(record.id, updated);
    }

    const renderResult = await this.renderPort.render(puml, 'svg');

    return {
      id: record.id,
      modelId: record.modelId,
      type: record.type,
      mode: 'detached',
      puml,
      svg: renderResult.svg,
      syntax_error: renderResult.error,
    };
  }

  /**
   * Reset diagram to 'model' mode (resyncs with ArchitectureModel).
   */
  async resetToModel(diagramId: string) {
    const record = await this.findDiagramRecord(diagramId);
    if (!record) throw new NotFoundException(`Diagram '${diagramId}' not found`);

    const model = await this.archService.findOne(record.modelId);
    const viewType = (record.type as ViewType) || 'container';
    const puml = generateDiagram(model, viewType);
    const now = new Date();

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db
        .update(diagrams)
        .set({ puml, mode: 'model', updatedAt: now })
        .where(eq(diagrams.id, record.id));
    } else {
      this.dbService.memDiagrams.set(record.id, {
        ...record,
        puml,
        mode: 'model',
        updatedAt: now,
      });
    }

    return this.getDiagram(record.id, 'json');
  }

  /**
   * Synchronize all `model`-mode diagrams for a given `ArchitectureModel`.
   */
  async syncModelDiagrams(model: ArchitectureModel): Promise<void> {
    await this.archService.syncDiagramsForModel(model);
  }

  /**
   * List all diagram views for a model (`context`, `container`, `component`).
   */
  async listDiagrams(modelId: string) {
    const defaultViews: ViewType[] = ['context', 'container', 'component'];
    const results: any[] = [];

    for (const view of defaultViews) {
      const diag = await this.getOrCreateDiagramForModel(modelId, view);
      results.push({
        id: diag.id,
        modelId: diag.modelId,
        type: diag.type,
        mode: diag.mode,
      });
    }

    return results;
  }

  private async findDiagramRecord(id: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      if (!UUID_RE.test(id)) return undefined;
      const found = await this.dbService.db.select().from(diagrams).where(eq(diagrams.id, id)).limit(1);
      return found[0];
    }
    return this.dbService.memDiagrams.get(id);
  }

  private async getOrCreateDiagramForModel(modelId: string, viewType: ViewType) {
    if (this.dbService.isConnected && this.dbService.db) {
      if (UUID_RE.test(modelId)) {
        const existing = await this.dbService.db
          .select()
          .from(diagrams)
          .where(and(eq(diagrams.modelId, modelId), eq(diagrams.type, viewType)))
          .limit(1);
        if (existing.length > 0) return existing[0]!;
      }
    } else {
      for (const d of this.dbService.memDiagrams.values()) {
        if (d.modelId === modelId && d.type === viewType) return d;
      }
    }

    const model = await this.archService.findOne(modelId);
    const puml = generateDiagram(model, viewType);
    const id = crypto.randomUUID();
    const now = new Date();

    const newDiagram = {
      id,
      modelId: model.id,
      type: viewType,
      mode: 'model',
      puml,
      svgS3Key: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(diagrams).values(newDiagram);
    } else {
      this.dbService.memDiagrams.set(id, newDiagram);
    }

    return newDiagram;
  }
}
