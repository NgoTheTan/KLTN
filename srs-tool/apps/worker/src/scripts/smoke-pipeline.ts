/**
 * Smoke test for the full 8-stage pipeline (S1 -> S8) against a real PostgreSQL.
 *
 *   docker compose -f srs-tool/docker/docker-compose.yml up -d postgres
 *   pnpm --dir srs-tool --filter @srs-tool/worker smoke
 *
 * Creates a user/project/document/run, executes PipelineProcessor in-process
 * (no Redis needed) and prints what all 8 stages persisted (segments, glossary,
 * questions, EARS normalized statements, merged duplicates, preservation & coverage).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createDbPool, createDb, runMigrations, schema } from '@srs-tool/db';
import { PipelineProcessor } from '../processors/pipeline.processor.js';

const SAMPLE = `# Yêu cầu hệ thống giám sát IoT — Sổ phủ (Coverage Ledger) & OTA (Over-The-Air)

## Chức năng
- Hệ thống phải thu thập dữ liệu từ cảm biến qua MQTT mỗi 5 giây.
- Hệ thống cần thu thập dữ liệu từ cảm biến qua MQTT mỗi 5 giây.
- Là người vận hành, tôi muốn nhận thông báo đẩy khi nhiệt độ vượt ngưỡng để xử lý sự cố kịp thời.
- Quản trị viên có thể xuất báo cáo nhanh theo ngày.

## Phi chức năng
Thời gian phản hồi của dashboard phải dưới 2 giây với 500 người dùng đồng thời.
Thời gian phản hồi của dashboard phải dưới 500 ms.

Lịch sử phiên bản tài liệu.
`;

async function main() {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-uploads-'));
  process.env['UPLOAD_DIR'] = uploadDir;

  const pool = createDbPool({ connectionString: process.env['DATABASE_URL'] });
  await runMigrations(pool);
  const db = createDb(pool);

  const [user] = await db
    .insert(schema.users)
    .values({ email: `smoke-${Date.now()}@example.com` })
    .returning();
  const [project] = await db
    .insert(schema.projects)
    .values({ ownerId: user!.id, name: 'Smoke IoT S1-S8', platforms: ['iot', 'web'], outputLanguage: 'vi' })
    .returning();

  const s3Key = `documents_${crypto.randomUUID()}_spec.md`;
  fs.writeFileSync(path.join(uploadDir, s3Key), SAMPLE, 'utf-8');
  await db.insert(schema.documents).values({
    projectId: project!.id,
    kind: 'srs',
    s3Key,
    sha256: crypto.createHash('sha256').update(SAMPLE).digest('hex'),
    filename: 'spec.md',
    mimeType: 'text/markdown',
  });

  const [run] = await db.insert(schema.runs).values({ projectId: project!.id, mode: 'eco' }).returning();

  const progress: number[] = [];
  const job = {
    id: run!.id,
    data: { runId: run!.id, projectId: project!.id, mode: 'eco', fromStage: 1 },
    updateProgress: async (p: number) => void progress.push(p),
  };
  await new PipelineProcessor(db).process(job as never);

  const segs = await db.select().from(schema.segments).where(eq(schema.segments.projectId, project!.id));
  const reqs = await db.select().from(schema.requirements).where(eq(schema.requirements.projectId, project!.id));
  const iss = await db.select().from(schema.issues).where(eq(schema.issues.projectId, project!.id));
  const qs = await db.select().from(schema.questions).where(eq(schema.questions.projectId, project!.id));
  const gls = await db.select().from(schema.glossaryTerms).where(eq(schema.glossaryTerms.projectId, project!.id));
  const logs = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.runId, run!.id));
  const [finalRun] = await db.select().from(schema.runs).where(eq(schema.runs.id, run!.id));

  console.log('\n=== SMOKE S1 -> S8 RESULT ===');
  console.log('progress:', progress.join(' → '), '| run:', finalRun!.status, finalRun!.progress);
  console.log(
    'segments by coverage:',
    segs.reduce<Record<string, number>>((a, s) => ((a[s.coverageStatus] = (a[s.coverageStatus] ?? 0) + 1), a), {}),
  );
  console.table(
    reqs.map((r) => ({
      code: r.code,
      type: r.type,
      ears: r.earsPattern,
      status: r.status,
      q: r.qualityScore,
      text: r.statement.slice(0, 58),
    })),
  );
  console.log('glossary terms:', gls.map((g) => `${g.termVi} (${g.termEn})`).join(', '));
  console.log('issues:', iss.map((i) => `${i.ruleId}[${i.kind}]`).join(', '));
  console.log('clarification questions (S5):', qs.length);
  console.log('decision_log rows:', logs.length);

  await db.delete(schema.users).where(eq(schema.users.id, user!.id));
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
