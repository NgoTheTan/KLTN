import * as fs from 'fs';
import * as path from 'path';
import type { Job } from 'bullmq';
import { eq, ne, and } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { schema, type DatabaseInstance } from '@srs-tool/db';
import { resolveUploadDir } from '../utils/storage-dir.js';

const { projects, segments, requirements, glossaryTerms, archModels, diagrams, exportsTable } = schema;

/**
 * ExportProcessor
 *
 * Builds ZIP export bundles asynchronously in the worker process (FR-EXP-001..005):
 * - SRS-Specification.md (with Coverage Ledger summary + Glossary + EARS Requirements + Tech Stack)
 * - Requirements-Traceability.csv (with UTF-8 BOM for Excel compatibility)
 * - diagrams/*.puml
 */
export class ExportProcessor {
  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const rawData = job.data as {
      projectId: string;
      exportId?: string;
      runId?: string;
      formats?: string[];
    };
    const projectId = rawData.projectId;
    const exportId = rawData.exportId ?? rawData.runId ?? '';
    const formats = rawData.formats ?? ['md', 'csv', 'puml'];
    if (!this.db) throw new Error('ExportProcessor requires DATABASE_URL');
    const db = this.db;

    await job.updateProgress(10);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const segs = await db.select().from(segments).where(eq(segments.projectId, projectId));
    const reqs = await db
      .select()
      .from(requirements)
      .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));
    const glossary = await db.select().from(glossaryTerms).where(eq(glossaryTerms.projectId, projectId));
    const [arch] = await db.select().from(archModels).where(eq(archModels.projectId, projectId)).limit(1);
    const diags = arch ? await db.select().from(diagrams).where(eq(diagrams.modelId, arch.id)) : [];

    const files: Record<string, Uint8Array> = {};

    if (formats.includes('md') || formats.includes('zip')) {
      const mapped = segs.filter((s) => s.coverageStatus === 'mapped').length;
      const notReq = segs.filter((s) => s.coverageStatus === 'not_requirement').length;
      const unres = segs.filter((s) => s.coverageStatus === 'unresolved').length;
      const pct = segs.length > 0 ? Math.round(((mapped + notReq) / segs.length) * 100) : 100;

      const md = [
        `# Software Requirements Specification: ${project.name}`,
        ``,
        `- **Platforms:** ${project.platforms.join(', ')}`,
        `- **Coverage:** ${pct}% (${mapped} mapped, ${notReq} non-requirement, ${unres} unresolved / ${segs.length} segments)`,
        ``,
        `## Glossary`,
        ...(glossary.length > 0
          ? glossary.map((g) => `- **${g.termVi}** (*${g.termEn}*): ${g.definition}`)
          : ['_No glossary terms recorded._']),
        ``,
        `## Standardized Requirements`,
        ...reqs.map(
          (r) =>
            `### ${r.code} [${r.type} | ${r.priority} | origin: ${r.origin}]\n${r.statement}\n\n- **Original:** ${r.statementOriginal}\n- **Acceptance Criteria:**\n\`\`\`\n${r.acceptanceCriteria ?? 'N/A'}\n\`\`\`\n`,
        ),
      ].join('\n');
      files['SRS-Specification.md'] = strToU8(md);
    }

    if (formats.includes('csv') || formats.includes('zip')) {
      const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
      const header = 'Code,Type,Priority,Origin,Status,EARS_Pattern,Quality_Score,Statement,Original_Statement';
      const rows = reqs.map((r) =>
        [
          esc(r.code),
          esc(r.type),
          esc(r.priority),
          esc(r.origin),
          esc(r.status),
          esc(r.earsPattern),
          String(r.qualityScore),
          esc(r.statement),
          esc(r.statementOriginal),
        ].join(','),
      );
      files['Requirements-Traceability.csv'] = strToU8('\uFEFF' + [header, ...rows].join('\n'));
    }

    if (formats.includes('puml') || formats.includes('zip')) {
      for (const d of diags) {
        files[`diagrams/${d.type}.puml`] = strToU8(d.puml);
      }
    }

    await job.updateProgress(75);

    const zipped = zipSync(files, { level: 6 });
    const uploadDir = resolveUploadDir();
    const s3Key = `exports_${projectId}_${exportId}.zip`;
    fs.writeFileSync(path.join(uploadDir, s3Key), Buffer.from(zipped));

    await db
      .update(exportsTable)
      .set({ s3Key, status: 'ready' })
      .where(eq(exportsTable.id, exportId));

    await job.updateProgress(100);
  }
}
