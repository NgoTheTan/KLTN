import { describe, it, expect, beforeEach } from 'vitest';
import { RequirementsService } from './requirements.service';
import { DatabaseService } from '../../db/database.service';
import { ConfigService } from '@nestjs/config';

describe('RequirementsService', () => {
  let reqService: RequirementsService;
  let dbService: DatabaseService;

  const mockQueue = {
    enqueue: async () => 'mock-job-id',
    getJobStatus: async () => ({ status: 'completed', progress: 100 }),
  };

  beforeEach(() => {
    dbService = new DatabaseService(new ConfigService());
    reqService = new RequirementsService(dbService, mockQueue as any);
  });

  it('creates requirement with version 1 snapshot', async () => {
    const req = await reqService.create('proj-1', {
      type: 'functional',
      platforms: ['web'],
      ears_pattern: 'ubiquitous',
      statement: 'Hệ thống phải hiển thị thông tin người dùng.',
      priority: 'must',
    });

    expect(req.id).toBeDefined();
    expect(req.code).toBeDefined();

    const detail = await reqService.findOne('proj-1', req.id);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].version).toBe(1);
    expect(detail.versions[0].snapshot.statement).toBe('Hệ thống phải hiển thị thông tin người dùng.');
  });

  it('updates requirement and appends version 2', async () => {
    const req = await reqService.create('proj-1', {
      type: 'functional',
      platforms: ['web'],
      ears_pattern: 'ubiquitous',
      statement: 'Phiên bản ban đầu',
    });

    const updated = await reqService.update('proj-1', req.id, {
      statement: 'Phiên bản đã cập nhật EARS',
    });

    expect(updated.statement).toBe('Phiên bản đã cập nhật EARS');
    expect(updated.versions).toHaveLength(2);
  });

  it('reverts requirement to version 1', async () => {
    const req = await reqService.create('proj-1', {
      type: 'functional',
      platforms: ['web'],
      ears_pattern: 'ubiquitous',
      statement: 'V1',
    });

    await reqService.update('proj-1', req.id, { statement: 'V2' });
    await reqService.update('proj-1', req.id, { statement: 'V3' });

    const reverted = await reqService.revert('proj-1', req.id, 1);
    expect(reverted.statement).toBe('V1');
    expect(reverted.versions).toHaveLength(4);
  });

  it('answers clarification question and generates new Segment', async () => {
    dbService.memQuestions.set('q-100', {
      id: 'q-100',
      projectId: 'proj-1',
      issueId: 'iss-1',
      text: 'Thời gian phản hồi tối đa là bao lâu?',
      status: 'pending',
    });

    const result = await reqService.answerQuestion('q-100', 'Tối đa 2.5 giây cho 95% yêu cầu');
    expect(result.status).toBe('answered');
    expect(result.answer_segment_id).toBeDefined();

    const newSegment = dbService.memSegments.get(result.answer_segment_id!);
    expect(newSegment).toBeDefined();
    expect(newSegment.text).toContain('2.5 giây');
    expect(newSegment.coverageStatus).toBe('mapped');
  });
});
