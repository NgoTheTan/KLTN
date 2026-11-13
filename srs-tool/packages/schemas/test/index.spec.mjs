import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SegmentSchema,
  ModelPatchSchema,
  CreateProjectDtoSchema,
  CoverageReportSchema,
} from '../dist/index.js';

test('SegmentSchema accepts both UUID and null document_id for clarification segments', () => {
  const docSeg = SegmentSchema.safeParse({
    id: '00000000-0000-4000-8000-000000000001',
    document_id: '00000000-0000-4000-8000-000000000002',
    ordinal: 1,
    text: 'Hệ thống phải phản hồi trong 200 ms.',
    locator: { line: 1 },
    language: 'vi',
    coverage_status: 'mapped',
  });
  assert.equal(docSeg.success, true);

  const answerSeg = SegmentSchema.safeParse({
    id: '00000000-0000-4000-8000-000000000003',
    document_id: null,
    ordinal: 0,
    text: 'Thời gian phản hồi p95 dưới 300 ms.',
    locator: { source: 'clarification_answer' },
    language: 'vi',
    coverage_status: 'mapped',
  });
  assert.equal(answerSeg.success, true);

  const invalidSeg = SegmentSchema.safeParse({
    id: 'iss_chk_invalid',
    document_id: null,
    ordinal: 0,
    text: 'x',
    locator: {},
    language: 'vi',
    coverage_status: 'mapped',
  });
  assert.equal(invalidSeg.success, false);
});

test('ModelPatchSchema enforces expected_version and allowed operations', () => {
  const ok = ModelPatchSchema.safeParse({
    expected_version: 1,
    reason: 'Add Redis cache',
    operations: [
      {
        op: 'add_element',
        element: {
          id: 'cache',
          kind: 'datastore',
          name: 'Redis Cache',
          technology: 'Redis',
          requirement_ids: ['NFR-WEB-001'],
        },
      },
    ],
  });
  assert.equal(ok.success, true);

  const missingVersion = ModelPatchSchema.safeParse({
    operations: [{ op: 'remove_element', element_id: 'cache' }],
  });
  assert.equal(missingVersion.success, false);

  const badOp = ModelPatchSchema.safeParse({
    expected_version: 1,
    operations: [{ op: 'drop_database', element_id: 'db' }],
  });
  assert.equal(badOp.success, false);
});

test('CreateProjectDtoSchema and CoverageReportSchema validate constraints', () => {
  assert.equal(
    CreateProjectDtoSchema.safeParse({ name: 'Demo SRS', platforms: ['web', 'iot'] }).success,
    true,
  );
  assert.equal(
    CreateProjectDtoSchema.safeParse({ name: '', platforms: [] }).success,
    false,
  );
  assert.equal(
    CoverageReportSchema.safeParse({
      total_segments: 10,
      mapped: 7,
      not_requirement: 3,
      unresolved: 0,
      unmapped: 0,
      coverage_pct: 100,
    }).success,
    true,
  );
});
