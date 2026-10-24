import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectsService } from './projects.service';
import { DatabaseService } from '../../db/database.service';
import { ConfigService } from '@nestjs/config';
import { SseService } from './sse.service';
import { UsageService } from '../usage/usage.service';

describe('ProjectsService', () => {
  let projectsService: ProjectsService;
  let dbService: DatabaseService;
  let sseService: SseService;
  let usageService: UsageService;

  const mockQueue = {
    enqueue: async () => 'mock-job-id',
    getJobStatus: async () => ({ status: 'completed', progress: 100 }),
  };

  beforeEach(() => {
    dbService = new DatabaseService(new ConfigService());
    usageService = new UsageService(dbService);
    sseService = new SseService();
    projectsService = new ProjectsService(dbService, mockQueue as any, usageService, sseService);
  });

  it('creates and finds project', async () => {
    const project = await projectsService.create(
      {
        name: 'Hệ thống IoT Giám Sát',
        platforms: ['web', 'iot'],
        output_language: 'vi',
      },
      'owner-1',
    );

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Hệ thống IoT Giám Sát');
    expect(project.platforms).toContain('iot');

    const found = await projectsService.findOne(project.id);
    expect(found.id).toBe(project.id);
  });

  it('calculates coverage ledger correctly', async () => {
    const project = await projectsService.create({ name: 'Coverage Test', platforms: ['web'] });

    // Add 4 segments: 2 mapped, 1 not_requirement, 1 unmapped
    dbService.memSegments.set('seg-1', {
      id: 'seg-1',
      projectId: project.id,
      coverageStatus: 'mapped',
    });
    dbService.memSegments.set('seg-2', {
      id: 'seg-2',
      projectId: project.id,
      coverageStatus: 'mapped',
    });
    dbService.memSegments.set('seg-3', {
      id: 'seg-3',
      projectId: project.id,
      coverageStatus: 'not_requirement',
    });
    dbService.memSegments.set('seg-4', {
      id: 'seg-4',
      projectId: project.id,
      coverageStatus: 'unmapped',
    });

    const report = await projectsService.getCoverage(project.id);
    expect(report.total_segments).toBe(4);
    expect(report.mapped).toBe(2);
    expect(report.not_requirement).toBe(1);
    expect(report.unmapped).toBe(1);
    expect(report.coverage_pct).toBe(75); // (2+1)/4 * 100
  });

  it('evaluates platform checklist and matches requirements', async () => {
    const project = await projectsService.create({
      name: 'IoT App',
      platforms: ['iot', 'web'],
    });

    // Add an IoT requirement with MQTT keyword
    dbService.memRequirements.set('req-1', {
      id: 'req-1',
      projectId: project.id,
      statement: 'Hệ thống phải nhận dữ liệu cảm biến qua giao thức MQTT trong 5 giây.',
      statementOriginal: 'Cảm biến gửi qua MQTT',
      platforms: ['iot'],
    });

    const checklist = await projectsService.getChecklist(project.id);
    expect(checklist.length).toBeGreaterThan(0);

    const protocolItem = checklist.find((c) => c.id === 'iot-protocol');
    expect(protocolItem).toBeDefined();
    expect(protocolItem?.status).toBe('covered');
    expect(protocolItem?.matchedRequirementId).toBe('req-1');
  });

  it('marks checklist item as not-applicable', async () => {
    const project = await projectsService.create({ name: 'Checklist Test', platforms: ['iot'] });

    await projectsService.updateChecklistItem(project.id, 'iot-ota', {
      not_applicable: true,
      reason: 'Thiết bị chạy ROM cứng không hỗ trợ OTA',
    });

    const checklist = await projectsService.getChecklist(project.id);
    const otaItem = checklist.find((c) => c.id === 'iot-ota');
    expect(otaItem?.status).toBe('not_applicable');
    expect(otaItem?.reason).toContain('ROM cứng');
  });

  it('starts a run in eco mode with 0 token reservation', async () => {
    const project = await projectsService.create({ name: 'Run Test', platforms: ['web'] });

    const run = await projectsService.startRun(project.id, { mode: 'eco' });
    expect(run.status).toBe('queued');
    expect(run.mode).toBe('eco');
    expect(run.estimated_tokens).toBe(0);
  });
});
