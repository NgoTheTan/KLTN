import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { exportsTable, requirements, glossaryTerms } from '../../db/schema';
import { eq, and, ne, desc } from 'drizzle-orm';
import { StoragePort, QueuePort } from '../../ports';
import { ArchitectureService } from '../architecture/architecture.service';
import { DiagramsService } from '../diagrams/diagrams.service';
import { ProjectsService } from '../projects/projects.service';
import { zipSync, strToU8 } from 'fflate';
import * as crypto from 'crypto';

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
   * POST /projects/:projectId/exports — Create a complete export bundle (FR-EXP-001..005).
   * Builds `SRS-Specification.md`, `Requirements-Traceability.csv` (with UTF-8 BOM),
   * and `diagrams/{context,container,component}.{puml,svg}` packaged into a real `.zip` archive
   * (or individual `.md` / `.csv` when only a single format is requested).
   */
  async createExport(
    projectId: string,
    formats: string[] = ['markdown', 'puml', 'svg', 'csv', 'zip'],
  ) {
    const exportId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Valid for 24 hours (FR-EXP-005)
    const normalizedFormats = formats.length > 0 ? formats.map((f) => f.toLowerCase()) : ['markdown', 'puml', 'svg', 'csv', 'zip'];

    const project = await this.projectsService.findOne(projectId);
    const coverage = await this.projectsService.getCoverage(projectId);

    let reqList: any[] = [];
    let glossary: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      reqList = await this.dbService.db
        .select()
        .from(requirements)
        .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));
      glossary = await this.dbService.db
        .select()
        .from(glossaryTerms)
        .where(eq(glossaryTerms.projectId, projectId));
    } else {
      reqList = Array.from(this.dbService.memRequirements.values()).filter(
        (r) => r.projectId === projectId && r.status !== 'rejected',
      );
      glossary = Array.from(this.dbService.memGlossary.values()).filter((g) => g.projectId === projectId);
    }

    let model: any = null;
    try {
      model = await this.archService.findByProject(projectId);
    } catch {
      model = null;
    }

    const markdownContent = this.buildMarkdownReport(project, coverage, glossary, reqList, model);
    const csvContent = '\uFEFF' + this.buildCsvExport(reqList);

    const wantsZip =
      normalizedFormats.includes('zip') ||
      normalizedFormats.length > 1 ||
      normalizedFormats.includes('puml') ||
      normalizedFormats.includes('svg');

    let uploadBuffer: Buffer;
    let s3Key: string;
    let contentType: string;

    if (!wantsZip && (normalizedFormats[0] === 'csv')) {
      uploadBuffer = Buffer.from(csvContent, 'utf-8');
      s3Key = `exports_${projectId}_${exportId}.csv`;
      contentType = 'text/csv; charset=utf-8';
    } else if (!wantsZip && (normalizedFormats[0] === 'markdown' || normalizedFormats[0] === 'md')) {
      uploadBuffer = Buffer.from(markdownContent, 'utf-8');
      s3Key = `exports_${projectId}_${exportId}.md`;
      contentType = 'text/markdown; charset=utf-8';
    } else {
      const zipEntries: Record<string, Uint8Array> = {
        'SRS-Specification.md': strToU8(markdownContent),
        'Requirements-Traceability.csv': strToU8(csvContent),
      };

      if (model) {
        zipEntries['architecture-model.json'] = strToU8(JSON.stringify(model, null, 2));
        const diagViews = await this.diagramsService.listDiagrams(model.id);
        for (const d of diagViews) {
          const rendered = await this.diagramsService.getDiagram(d.id, 'json');
          if (rendered.puml) {
            zipEntries[`diagrams/${d.type}.puml`] = strToU8(rendered.puml);
          }
          if (rendered.svg) {
            zipEntries[`diagrams/${d.type}.svg`] = strToU8(rendered.svg);
          }
        }
      }

      const zipped = zipSync(zipEntries, { level: 6 });
      uploadBuffer = Buffer.from(zipped);
      s3Key = `exports_${projectId}_${exportId}.zip`;
      contentType = 'application/zip';
    }

    const uploadResult = await this.storage.upload(uploadBuffer, s3Key, contentType);
    const downloadUrl = await this.storage.presignedUrl(uploadResult.s3Key, 86400);

    const exportRecord = {
      id: exportId,
      projectId,
      formats: normalizedFormats,
      s3Key: uploadResult.s3Key,
      status: 'ready',
      expiresAt,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      await this.dbService.db.insert(exportsTable).values(exportRecord);
    } else {
      this.dbService.memExports.set(exportId, exportRecord);
    }

    this.logger.log(
      `Created export ${exportId} (${uploadBuffer.length} bytes) for project ${projectId} (formats: ${normalizedFormats.join(', ')})`,
    );

    return {
      export_id: exportId,
      projectId,
      status: 'ready',
      formats: normalizedFormats,
      size_bytes: uploadBuffer.length,
      expires_at: expiresAt.toISOString(),
      download_url: downloadUrl,
    };
  }

  /**
   * GET /projects/:projectId/exports — List exports for a project.
   */
  async listExports(projectId: string) {
    let rows: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      rows = await this.dbService.db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.projectId, projectId))
        .orderBy(desc(exportsTable.createdAt));
    } else {
      rows = Array.from(this.dbService.memExports.values()).filter((e) => e.projectId === projectId);
    }

    const now = new Date();
    return Promise.all(
      rows.map(async (r) => {
        const isExpired = new Date(r.expiresAt) < now;
        return {
          export_id: r.id,
          projectId: r.projectId,
          status: isExpired ? 'expired' : r.status,
          formats: r.formats,
          expires_at: new Date(r.expiresAt).toISOString(),
          created_at: new Date(r.createdAt).toISOString(),
          download_url: !isExpired && r.s3Key ? await this.storage.presignedUrl(r.s3Key, 86400) : null,
        };
      }),
    );
  }

  /**
   * GET /exports/:id — Get export status and presigned download URL (enforces 24h TTL).
   */
  async getExport(exportId: string) {
    let record: any;
    if (this.dbService.isConnected && this.dbService.db) {
      const found = await this.dbService.db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
      if (found.length > 0) record = found[0];
    } else {
      record = this.dbService.memExports.get(exportId);
    }

    if (!record) throw new NotFoundException(`Export package '${exportId}' not found`);

    const expiresDate = new Date(record.expiresAt);
    const remainingSeconds = Math.floor((expiresDate.getTime() - Date.now()) / 1000);
    if (remainingSeconds <= 0) {
      return {
        export_id: exportId,
        projectId: record.projectId,
        status: 'expired',
        expires_at: expiresDate.toISOString(),
        download_url: null,
        message: 'This export link has expired. Please create a new export package.',
      };
    }

    const downloadUrl = record.s3Key
      ? await this.storage.presignedUrl(record.s3Key, Math.min(86400, remainingSeconds))
      : null;

    return {
      export_id: exportId,
      projectId: record.projectId,
      status: record.status,
      formats: record.formats,
      expires_at: expiresDate.toISOString(),
      download_url: downloadUrl,
    };
  }

  private buildMarkdownReport(
    project: any,
    coverage: any,
    glossary: any[],
    reqs: any[],
    model: any,
  ): string {
    const lines: string[] = [
      `# BÁO CÁO ĐẶC TẢ YÊU CẦU & THIẾT KẾ KIẾN TRÚC HỆ THỐNG`,
      ``,
      `- **Dự án:** ${project.name}`,
      `- **Nền tảng:** ${(project.platforms || []).join(', ')}`,
      `- **Ngôn ngữ đầu ra:** ${project.outputLanguage || 'vi'}`,
      `- **Thời gian xuất:** ${new Date().toISOString()}`,
      ``,
      `## 1. Sổ Độ Phủ Yêu Cầu (Coverage Ledger)`,
      `- Tổng số đoạn nguồn: ${coverage.total_segments}`,
      `- Đã ánh xạ sang yêu cầu (\`mapped\`): ${coverage.mapped}`,
      `- Không phải yêu cầu (\`not_requirement\`): ${coverage.not_requirement}`,
      `- Chưa làm rõ (\`unresolved\`): ${coverage.unresolved}`,
      `- Chưa ánh xạ (\`unmapped\`): ${coverage.unmapped}`,
      `- **Tỷ lệ độ phủ:** ${coverage.coverage_pct}%`,
      ``,
      `## 2. Bảng Thuật Ngữ Song Ngữ (Glossary)`,
    ];

    if (glossary.length === 0) {
      lines.push(`_Chưa có thuật ngữ nào được ghi nhận._`);
    } else {
      lines.push(`| Tiếng Việt | Tiếng Anh | Định nghĩa |`);
      lines.push(`| --- | --- | --- |`);
      for (const g of glossary) {
        lines.push(`| ${g.termVi || '-'} | ${g.termEn || '-'} | ${(g.definition || '-').replace(/\n/g, ' ')} |`);
      }
    }

    lines.push(``);
    lines.push(`## 3. Danh Sách Yêu Cầu Chuẩn Hoá (EARS & INCOSE)`);
    lines.push(
      `| Mã | Phân loại | Nguồn gốc | Kiểu EARS | Ưu tiên | Câu yêu cầu chuẩn hoá | Tiêu chí nghiệm thu (Given/When/Then) | Điểm |`,
    );
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);

    for (const r of reqs) {
      const gwt = (r.acceptanceCriteria || '-').replace(/\n/g, '<br/>').replace(/\|/g, '\\|');
      const stmt = (r.statement || '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
      lines.push(
        `| ${r.code} | ${r.type} | ${r.origin || 'explicit'} | ${r.earsPattern} | ${r.priority} | ${stmt} | ${gwt} | ${r.qualityScore ?? 100}/100 |`,
      );
    }

    if (model) {
      lines.push(``);
      lines.push(`## 4. Kiến Trúc Hệ Thống (C4 Model — Phiên bản v${model.version})`);
      lines.push(`### 4.1 Thành phần kiến trúc (Elements)`);
      for (const el of model.elements || []) {
        lines.push(
          `- **${el.name}** (\`${el.id}\`, \`${el.kind}\`): ${el.description || ''} — *Công nghệ:* ${el.technology || 'N/A'}`,
        );
      }

      lines.push(``);
      lines.push(`### 4.2 Quan hệ & Giao thức (Relationships)`);
      for (const rel of model.relationships || []) {
        lines.push(
          `- \`${rel.source_id}\` -> \`${rel.target_id}\`: ${rel.label}${rel.protocol ? ` [${rel.protocol}]` : ''}`,
        );
      }

      lines.push(``);
      lines.push(`### 4.3 Lựa chọn Công nghệ & Đánh đổi (Tech Stack Recommendations)`);
      for (const tc of model.tech_choices || []) {
        lines.push(`- **${tc.layer}:** ${tc.choice}`);
        lines.push(`  - *Lý do & Đánh đổi:* ${tc.rationale}`);
        if (tc.alternatives?.length > 0) {
          lines.push(`  - *Phương án thay thế:* ${tc.alternatives.join(', ')}`);
        }
      }
    }

    return lines.join('\n');
  }

  private buildCsvExport(reqs: any[]): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'Code',
      'Type',
      'Origin',
      'Status',
      'Platforms',
      'EARS_Pattern',
      'Priority',
      'Is_ASR',
      'Quality_Score',
      'Statement',
      'Original_Statement',
      'Acceptance_Criteria',
    ];
    const rows = reqs.map((r) =>
      [
        esc(r.code),
        esc(r.type),
        esc(r.origin || 'explicit'),
        esc(r.status || 'candidate'),
        esc((r.platforms || []).join(';')),
        esc(r.earsPattern),
        esc(r.priority),
        esc(Boolean(r.isAsr)),
        String(r.qualityScore ?? 100),
        esc(r.statement),
        esc(r.statementOriginal),
        esc(r.acceptanceCriteria),
      ].join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
}
