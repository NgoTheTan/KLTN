import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { diagrams } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { RenderPort } from '../../ports';
import { ArchitectureService } from '../architecture/architecture.service';
import { generateDiagram } from '@srs-tool/plantuml-gen';
import { ViewType } from '@srs-tool/schemas';

@Injectable()
export class DiagramsService {
  private readonly logger = new Logger(DiagramsService.name);
  private readonly svgCache = new Map<string, string>(); // hash/key -> rendered SVG

  constructor(
    private readonly dbService: DatabaseService,
    private readonly archService: ArchitectureService,
    @Inject('RENDER_PORT') private readonly renderPort: RenderPort,
  ) {}

  /**
   * Get diagram by ID and format (svg, png, puml).
   */
  async getDiagram(id: string, format: 'svg' | 'png' | 'puml' = 'svg') {
    let diagramRecord = await this.findDiagramRecord(id);

    // If diagram record doesn't exist directly, check if 'id' is a modelId or viewType
    if (!diagramRecord) {
      diagramRecord = await this.getOrCreateDiagramForModel(id, 'container');
    }

    let pumlSource = diagramRecord.puml;

    // In 'model' mode, regenerate PlantUML from ArchitectureModel so it is always synchronized
    if (diagramRecord.mode === 'model') {
      try {
        const model = await this.archService.findOne(diagramRecord.modelId);
        const viewType = (diagramRecord.type as ViewType) || 'container';
        pumlSource = generateDiagram(model, viewType);

        // Update stored puml
        diagramRecord.puml = pumlSource;
      } catch (err: any) {
        this.logger.warn(`Could not regenerate diagram from model: ${err.message}. Using stored PUML.`);
      }
    }

    if (format === 'puml') {
      return {
        id,
        format: 'puml',
        mode: diagramRecord.mode,
        type: diagramRecord.type,
        content: pumlSource,
      };
    }

    // Render SVG/PNG via RenderPort
    const cacheKey = `${diagramRecord.id}_${pumlSource.length}_${format}`;
    if (format === 'svg' && this.svgCache.has(cacheKey)) {
      return {
        id,
        format: 'svg',
        mode: diagramRecord.mode,
        type: diagramRecord.type,
        svg: this.svgCache.get(cacheKey),
        puml: pumlSource,
      };
    }

    const renderResult = await this.renderPort.render(pumlSource, format === 'png' ? 'png' : 'svg');

    if (format === 'svg' && renderResult.svg) {
      this.svgCache.set(cacheKey, renderResult.svg);
    }

    return {
      id,
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
   */
  async updatePuml(diagramId: string, puml: string) {
    const record = await this.findDiagramRecord(diagramId);
    if (!record) throw new NotFoundException(`Diagram '${diagramId}' not found`);

    const updated = {
      ...record,
      puml,
      mode: 'detached',
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db
          .update(diagrams)
          .set({ puml, mode: 'detached', updatedAt: new Date() })
          .where(eq(diagrams.id, diagramId));
      } catch {}
    }
    this.dbService.memDiagrams.set(diagramId, updated);

    // Render immediately to validate syntax
    const renderResult = await this.renderPort.render(puml, 'svg');

    return {
      id: diagramId,
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

    const updated = {
      ...record,
      puml,
      mode: 'model',
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db
          .update(diagrams)
          .set({ puml, mode: 'model', updatedAt: new Date() })
          .where(eq(diagrams.id, diagramId));
      } catch {}
    }
    this.dbService.memDiagrams.set(diagramId, updated);

    return this.getDiagram(diagramId, 'svg');
  }

  /**
   * List all diagram views for a model.
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
      try {
        const found = await this.dbService.db.select().from(diagrams).where(eq(diagrams.id, id)).limit(1);
        if (found.length > 0) return found[0];
      } catch {}
    }
    return this.dbService.memDiagrams.get(id);
  }

  private async getOrCreateDiagramForModel(modelId: string, viewType: ViewType) {
    // Check if exists
    for (const d of this.dbService.memDiagrams.values()) {
      if (d.modelId === modelId && d.type === viewType) return d;
    }

    const model = await this.archService.findOne(modelId);
    const puml = generateDiagram(model, viewType);
    const id = `diag_${viewType}_${modelId.substring(0, 8)}`;

    const newDiagram = {
      id,
      modelId,
      type: viewType,
      mode: 'model',
      puml,
      svgS3Key: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(diagrams).values(newDiagram);
      } catch {}
    }
    this.dbService.memDiagrams.set(id, newDiagram);

    return newDiagram;
  }
}
