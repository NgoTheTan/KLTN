import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { exportsTable, requirements, archModels } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { StoragePort, QueuePort } from '../../ports';
import { ArchitectureService } from '../architecture/architecture.service';
import { DiagramsService } from '../diagrams/diagrams.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly archService: ArchitectureService,
    private readonly diagramsService: DiagramsService,
    private readonly projectsService: ProjectsService,
    @Inject('STORAGE_PORT') private readonly storage: StoragePort,
    @Inject('QUEUE_PORT') private readonly queue: QueuePort,
  ) {}

  /**
   * POST /projects/:projectId/exports — Create an export package.
   */
  async createExport(projectId: string, formats: string[] = ['markdown', 'puml', 'svg', 'csv', 'zip']) {
    const exportId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Valid for 24 hours

    // Generate package content
    const project = await this.projectsService.findOne(projectId);
    const coverage = await this.projectsService.getCoverage(projectId);

    let reqList: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        reqList = await this.dbService.db.select().from(requirements).where(eq(requirements.projectId, projectId));
      } catch {}
    } else {
      reqList = Array.from(this.dbService.memRequirements.values()).filter((r) => r.projectId === projectId);
    }

    let model: any;
    try {
      model = await this.archService.findByProject(projectId);
    } catch {
      model = null;
    }

    // Build markdown document
    const markdownContent = this.buildMarkdownReport(project, coverage, reqList, model);
    const csvContent = this.buildCsvExport(reqList);

    // Save bundle to storage
    const s3Key = `exports/${projectId}/${exportId}/export_bundle.md`;
    const uploadResult = await this.storage.upload(Buffer.from(markdownContent, 'utf-8'), s3Key, 'text/markdown');

    const downloadUrl = await this.storage.presignedUrl(uploadResult.s3Key, 86400);

    const exportRecord = {
      id: exportId,
      projectId,
      formats,
      s3Key: uploadResult.s3Key,
      status: 'ready',
      expiresAt,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(exportsTable).values(exportRecord);
      } catch {
        this.dbService.memExports.set(exportId, exportRecord);
      }
    } else {
      this.dbService.memExports.set(exportId, exportRecord);
    }

    // Also enqueue to worker for heavy ZIP/PDF generation if requested
    if (formats.includes('zip') || formats.includes('pdf') || formats.includes('docx')) {
      await this.queue.enqueue({
        type: 'export',
        projectId,
        runId: exportId,
        formats,
      });
    }

    this.logger.log(`Created export ${exportId} for project ${projectId} (formats: ${formats.join(', ')})`);

    return {
      export_id: exportId,
      projectId,
      status: 'ready',
      formats,
      expires_at: expiresAt.toISOString(),
      download_url: downloadUrl,
    };
  }

  /**
   * GET /exports/:id — Get export status and presigned download URL.
   */
  async getExport(exportId: string) {
    let record: any;
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const found = await this.dbService.db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
        if (found.length > 0) record = found[0];
      } catch {}
    }
    if (!record) record = this.dbService.memExports.get(exportId);

    if (!record) throw new NotFoundException(`Export package '${exportId}' not found`);

    const isExpired = new Date(record.expiresAt) < new Date();
    if (isExpired) {
      return {
        export_id: exportId,
        status: 'expired',
        message: 'This export link has expired. Please create a new export package.',
      };
    }

    const downloadUrl = record.s3Key ? await this.storage.presignedUrl(record.s3Key, 86400) : null;

    return {
      export_id: exportId,
      projectId: record.projectId,
      status: record.status,
      formats: record.formats,
      expires_at: record.expiresAt,
      download_url: downloadUrl,
    };
  }

  private buildMarkdownReport(project: any, coverage: any, reqs: any[], model: any): string {
    const lines: string[] = [
      `# BÁO CÁO ĐẶC TẢ YÊU CẦU & THIẾT KẾ KIẾN TRÚC HỆ THỐNG`,
      `**Dự án:** ${project.name}`,
      `**Nền tảng:** ${(project.platforms || []).join(', ')}`,
      `**Ngôn ngữ đầu ra:** ${project.outputLanguage || 'vi'}`,
      `**Thời gian tạo:** ${new Date().toLocaleString('vi-VN')}`,
      '',
      `## 1. Sổ Độ Phủ Yêu Cầu (Coverage Ledger)`,
      `- Tổng số đoạn nguồn: ${coverage.total_segments}`,
      `- Số đoạn đã có yêu cầu tương ứng: ${coverage.mapped}`,
      `- Số đoạn xác định không phải yêu cầu: ${coverage.not_requirement}`,
      `- Số đoạn chưa giải quyết: ${coverage.unresolved}`,
      `- **Độ phủ tài liệu:** ${coverage.coverage_pct}%`,
      '',
      `## 2. Danh Sách Yêu Cầu Đã Chuẩn Hoá (EARS & INCOSE)`,
      `| Mã | Phân loại | Kiểu EARS | Mức ưu tiên | Câu yêu cầu chuẩn hoá | Tiêu chí nghiệm thu (Given/When/Then) | Điểm chất lượng |`,
      `| --- | --- | --- | --- | --- | --- | --- |`,
    ];

    for (const r of reqs) {
      const gwt = (r.acceptanceCriteria || '-').replace(/\n/g, ' ');
      lines.push(
        `| ${r.code} | ${r.type} | ${r.earsPattern} | ${r.priority} | ${r.statement} | ${gwt} | ${r.qualityScore || 100}/100 |`,
      );
    }

    if (model) {
      lines.push('');
      lines.push(`## 3. Kiến Trúc Hệ Thống (Phiên bản ${model.version})`);
      lines.push(`### Thành phần hệ thống (Elements)`);
      for (const el of model.elements || []) {
        lines.push(`- **${el.name}** (${el.kind}): ${el.description || ''} [Công nghệ: ${el.technology || 'Chưa định nghĩa'}]`);
      }

      lines.push('');
      lines.push(`### Lựa chọn công nghệ & Đánh đổi (Tech Stack Choices)`);
      for (const tc of model.tech_choices || []) {
        lines.push(`- **${tc.layer}:** ${tc.choice}`);
        lines.push(`  - *Lý do:* ${tc.rationale}`);
        if (tc.alternatives?.length > 0) {
          lines.push(`  - *Phương án thay thế xem xét:* ${tc.alternatives.join(', ')}`);
        }
      }
    }

    return lines.join('\n');
  }

  private buildCsvExport(reqs: any[]): string {
    const headers = ['Code', 'Type', 'Platform', 'EARS Pattern', 'Priority', 'Statement', 'Quality Score'];
    const rows = reqs.map((r) => [
      r.code,
      r.type,
      (r.platforms || []).join(';'),
      r.earsPattern,
      r.priority,
      `"${(r.statement || '').replace(/"/g, '""')}"`,
      r.qualityScore || 100,
    ]);
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }
}
