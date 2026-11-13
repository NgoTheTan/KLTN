import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unzipSync, strFromU8 } from 'fflate';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

describe('Full Fastify HTTP E2E Smoke Suite (/api/v1)', () => {
  let app: NestFastifyApplication;
  let tmpUploadDir: string;

  beforeAll(async () => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-http-e2e-'));
    process.env['DATABASE_URL'] = '';
    process.env['REDIS_URL'] = 'memory';
    process.env['UPLOAD_DIR'] = tmpUploadDir;
    process.env['PLANTUML_URL'] = 'http://127.0.0.1:1';

    // Load compiled NestJS AppModule (`dist/app.module.js`) with full emitDecoratorMetadata
    const compiledPath = path.resolve(__dirname, '../../dist/app.module.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require(compiledPath);

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false, bodyLimit: 30 * 1024 * 1024 }),
      { logger: false },
    );
    app.enableCors({ origin: true, credentials: true });
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('executes full HTTP lifecycle: Auth -> Project -> Ingest -> Checklist -> Arch -> Diagram SVG -> Agent -> ZIP Export -> Storage Download', async () => {
    // 1. POST /api/v1/auth/dev-token
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/dev-token',
      payload: { email: 'e2e@srs-tool.local' },
    });
    expect(authRes.statusCode).toBe(201);
    const { accessToken, user } = authRes.json();
    expect(accessToken).toBeDefined();
    expect(user.email).toBe('e2e@srs-tool.local');

    const headers = { authorization: `Bearer ${accessToken}` };

    // 2. PATCH /api/v1/auth/me (locale update works; plan self-escalation is rejected by AuthService if attempted)
    const localeRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers,
      payload: { locale: 'en' },
    });
    expect(localeRes.statusCode).toBe(200);
    expect(localeRes.json().locale).toBe('en');

    // 3. POST /api/v1/projects
    const projRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload: {
        name: 'Hệ thống Nhà kính Thông minh KLTN',
        platforms: ['web', 'iot'],
        output_language: 'vi',
      },
    });
    expect(projRes.statusCode).toBe(201);
    const proj = projRes.json();

    // 4. POST /api/v1/projects/:id/documents (Markdown SRS)
    const ingestRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${proj.id}/documents`,
      headers,
      payload: {
        filename: 'srs-greenhouse.md',
        kind: 'srs',
        text: '# Đặc tả Hệ thống\n- Khi độ ẩm dưới 40%, hệ thống phải bật bơm qua giao thức MQTT trong 3 giây.',
      },
    });
    expect(ingestRes.statusCode).toBe(201);
    expect(ingestRes.json().document_id).toBeDefined();

    // 5. POST /api/v1/projects/:id/requirements + GET /checklist
    const reqRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${proj.id}/requirements`,
      headers,
      payload: {
        code: 'FR-IOT-001',
        type: 'functional',
        platforms: ['iot'],
        ears_pattern: 'event-driven',
        statement: 'Khi độ ẩm dưới 40%, hệ thống phải gửi lệnh bật bơm qua giao thức MQTT trong 3 giây.',
        priority: 'must',
        is_asr: true,
      },
    });
    expect(reqRes.statusCode).toBe(201);

    const checklistRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${proj.id}/checklist`,
      headers,
    });
    expect(checklistRes.statusCode).toBe(200);
    const checklist = checklistRes.json();
    expect(checklist.find((c: any) => c.id === 'iot-protocol')?.status).toBe('covered');

    // 6. POST /api/v1/projects/:id/architecture + GET /diagrams/:id?format=svg
    const archRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${proj.id}/architecture`,
      headers,
      payload: {},
    });
    expect(archRes.statusCode).toBe(201);
    const model = archRes.json();
    expect(model.elements.some((e: any) => e.id === 'target_system')).toBe(true);
    expect(model.elements.some((e: any) => e.id === 'mqtt_broker')).toBe(true);

    const svgRes = await app.inject({
      method: 'GET',
      url: `/api/v1/diagrams/${model.id}?format=svg`,
      headers,
    });
    expect(svgRes.statusCode).toBe(200);
    expect(svgRes.headers['content-type']).toContain('image/svg+xml');
    expect(svgRes.body).toContain('<svg');
    expect(svgRes.body).toContain('API Server');

    // 7. POST /api/v1/projects/:id/exports + GET /api/v1/storage/files/:key
    const expRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${proj.id}/exports`,
      headers,
      payload: { formats: ['markdown', 'csv', 'puml', 'svg', 'zip'] },
    });
    expect(expRes.statusCode).toBe(201);
    const exp = expRes.json();
    expect(exp.download_url).toContain('/api/v1/storage/files/');

    const dlRes = await app.inject({
      method: 'GET',
      url: exp.download_url,
    });
    expect(dlRes.statusCode).toBe(200);
    expect(dlRes.headers['content-type']).toBe('application/zip');

    const zipBytes = new Uint8Array(dlRes.rawPayload);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'

    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped)).toContain('SRS-Specification.md');
    expect(Object.keys(unzipped)).toContain('Requirements-Traceability.csv');
    expect(strFromU8(unzipped['SRS-Specification.md']!)).toContain('Hệ thống Nhà kính Thông minh KLTN');
  });
});
