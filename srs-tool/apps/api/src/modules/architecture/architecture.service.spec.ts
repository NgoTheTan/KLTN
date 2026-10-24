import { describe, it, expect, beforeEach } from 'vitest';
import { ArchitectureService } from './architecture.service';
import { DatabaseService } from '../../db/database.service';
import { ConfigService } from '@nestjs/config';

describe('ArchitectureService', () => {
  let archService: ArchitectureService;
  let dbService: DatabaseService;

  const mockQueue = {
    enqueue: async () => 'mock-job-id',
    getJobStatus: async () => ({ status: 'completed', progress: 100 }),
  };

  beforeEach(() => {
    dbService = new DatabaseService(new ConfigService());
    archService = new ArchitectureService(dbService, mockQueue as any);
  });

  it('synthesizes default architecture model based on project platforms', async () => {
    const model = await archService.synthesizeArchitecture('proj-arch-1');
    expect(model.id).toBeDefined();
    expect(model.version).toBe(1);
    expect(model.elements.length).toBeGreaterThanOrEqual(4);
    expect(model.relationships.length).toBeGreaterThanOrEqual(3);
    expect(model.tech_choices.length).toBeGreaterThan(0);
  });

  it('applies ModelPatch with optimistic concurrency verification', async () => {
    const model = await archService.synthesizeArchitecture('proj-arch-2');

    // Apply patch with correct expected_version
    const updated = await archService.applyPatch(model.id, {
      expected_version: 1,
      operations: [
        {
          op: 'add_element',
          element: {
            id: 'analytics_service',
            kind: 'container',
            name: 'Analytics Service',
            technology: 'Python',
            requirement_ids: [],
          },
        },
      ],
    });

    expect(updated.version).toBe(2);
    expect(updated.elements.some((e) => e.id === 'analytics_service')).toBe(true);

    // Apply patch with outdated expected_version -> should throw ConflictException
    await expect(
      archService.applyPatch(model.id, {
        expected_version: 1, // now at 2
        operations: [],
      }),
    ).rejects.toThrow('Version conflict');
  });

  it('removes element and prevents dangling relationships', async () => {
    const model = await archService.synthesizeArchitecture('proj-arch-3');

    // Remove api_server (which had relations)
    const updated = await archService.applyPatch(model.id, {
      expected_version: 1,
      operations: [
        {
          op: 'remove_element',
          element_id: 'api_server',
        },
      ],
    });

    expect(updated.elements.some((e) => e.id === 'api_server')).toBe(false);
    // Ensure no relationships have api_server as source or target
    const hasDangling = updated.relationships.some(
      (rel) => rel.source_id === 'api_server' || rel.target_id === 'api_server',
    );
    expect(hasDangling).toBe(false);
  });

  it('executes fixed command through CommandParser without LLM', async () => {
    const model = await archService.synthesizeArchitecture('proj-arch-4');

    const result = await archService.executeCommand(
      model.id,
      'rename element database to PrimaryPostgreSQL',
    );

    expect(result.command_type).toBe('rename');
    expect(result.version).toBe(2);

    const reloaded = await archService.findOne(model.id);
    const dbEl = reloaded.elements.find((e) => e.id === 'database');
    expect(dbEl?.name).toBe('PrimaryPostgreSQL');
  });
});
