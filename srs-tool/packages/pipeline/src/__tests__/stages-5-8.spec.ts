import { describe, it, expect } from 'vitest';
import {
  CoverageLedger,
  DecisionRouter,
  DEFAULT_STAGE_THRESHOLDS,
  S1ParseAndSegment,
  ScannedPdfError,
  S3ClassifyAndTag,
  runQuestionBuilding,
  runNormalization,
  runMergeAndReduce,
  runCoverageAndPreservation,
} from '../index.js';

const RUN_ID = '00000000-0000-4000-8000-000000000099';

function makeRouter() {
  return new DecisionRouter({
    mode: 'eco',
    stageThresholds: { ...DEFAULT_STAGE_THRESHOLDS },
  });
}

describe('S1 Scanned PDF guard & S3 Glossary extraction', () => {
  it('throws ScannedPdfError when a PDF lacks extractable text (FR-ING-008)', async () => {
    const ledger = new CoverageLedger();
    const s1 = new S1ParseAndSegment(ledger);
    await expect(
      s1.process({
        documentId: '00000000-0000-4000-8000-000000000001',
        content: '   \n  ',
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ScannedPdfError);
  });

  it('extracts bilingual glossary pairs from source text without LLM (FR-REQ-015)', () => {
    const s3 = new S3ClassifyAndTag();
    const terms = s3.extractGlossaryCandidates([
      {
        text: 'Hệ thống duy trì Sổ phủ (Coverage Ledger) và hỗ trợ cập nhật OTA (Over-The-Air) cho thiết bị.',
        language: 'vi',
      },
    ]);
    expect(terms.some((t) => t.termEn === 'Coverage Ledger')).toBe(true);
    expect(terms.some((t) => t.termVi === 'OTA' && t.termEn === 'Over-The-Air')).toBe(true);
  });
});

describe('S5→S8 Pipeline Orchestration (Eco Mode — 0 LLM tokens)', () => {
  it('S5 builds slot-filled bilingual questions for vague terms, numeric conflicts, and checklist gaps', () => {
    const questions = runQuestionBuilding(
      [
        {
          issue_id: 'iss-1',
          rule_id: 'INCOSE-001',
          kind: 'ambiguous',
          severity: 'warning',
          message: 'Chứa từ mơ hồ',
          requirement_text: 'Hệ thống phải tải bảng điều khiển nhanh.',
        },
        {
          issue_id: 'iss-2',
          rule_id: 'CONFLICT-NUM',
          kind: 'conflict',
          severity: 'error',
          message: 'Conflicting response_time: "2 giây" vs "500 ms"',
          requirement_text: 'Hệ thống phải phản hồi trong 2 giây.',
        },
        {
          issue_id: 'iss-3',
          rule_id: 'CHECKLIST-web-backup',
          kind: 'missing',
          severity: 'warning',
          message: 'Chưa có yêu cầu nào đề cập: Sao lưu — Chu kỳ sao lưu RPO/RTO là bao nhiêu?',
          requirement_text: '',
        },
      ],
      { outputLanguage: 'vi', platformDefaults: { response_time_p95_ms: 200, backup_rpo_hours: 24 } },
    );

    expect(questions).toHaveLength(3);
    const conflictQ = questions.find((q) => q.rule_id === 'CONFLICT-NUM')!;
    expect(conflictQ.suggested_values).toEqual(['2 giây', '500 ms']);

    const vagueQ = questions.find((q) => q.rule_id === 'INCOSE-001')!;
    expect(vagueQ.text).toContain('"nhanh"');

    const checklistQ = questions.find((q) => q.rule_id === 'CHECKLIST-web-backup')!;
    expect(checklistQ.text).toContain('RPO/RTO');
    expect(checklistQ.proposed_value).toContain('24');
  });

  it('S6 normalizes User Stories and modal sentences into EARS + Given/When/Then while preserving metrics', async () => {
    const router = makeRouter();
    const res = await runNormalization(
      [
        {
          id: '00000000-0000-4000-8000-000000000011',
          text: 'Là người vận hành, tôi muốn nhận cảnh báo trong 5 giây khi cảm biến mất kết nối để xử lý sự cố kịp thời.',
          language: 'vi',
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          text: 'When a user submits invalid credentials 5 times, the API server must lock the account for 15 minutes.',
          language: 'en',
        },
      ],
      { runId: RUN_ID, router },
    );

    expect(res).toHaveLength(2);
    const viNorm = res[0]!.normalization!;
    expect(viNorm.ears_pattern).toBe('event-driven');
    expect(viNorm.statement).toContain('Khi cảm biến mất kết nối');
    expect(viNorm.statement).toContain('5 giây');
    expect(viNorm.rationale).toContain('xử lý sự cố kịp thời');
    expect(viNorm.metric?.response_measure).toContain('5 giây');
    expect(viNorm.acceptance_criteria).toContain('Cho trước:');

    const enNorm = res[1]!.normalization!;
    expect(enNorm.ears_pattern).toBe('event-driven');
    expect(enNorm.statement).toContain('shall lock the account for 15 minutes');
    expect(enNorm.acceptance_criteria).toContain('Given:');
  });

  it('S7 merges near-verbatim duplicates while hard-blocking differing numbers or negations (FR-REQ-009)', async () => {
    const router = makeRouter();
    const mergeResult = await runMergeAndReduce(
      [
        {
          id: 'req-a',
          text: 'Hệ thống phải phản hồi yêu cầu tra cứu đơn hàng trong 200 ms.',
          language: 'vi',
          qualityScore: 100,
        },
        {
          id: 'req-b-dup',
          text: 'Hệ thống cần phản hồi yêu cầu tra cứu đơn hàng trong 200 ms.',
          language: 'vi',
          qualityScore: 90,
        },
        {
          id: 'req-c-diff-num',
          text: 'Hệ thống phải phản hồi yêu cầu tra cứu đơn hàng trong 500 ms.',
          language: 'vi',
          qualityScore: 95,
        },
        {
          id: 'req-d-negated',
          text: 'Hệ thống không được phản hồi yêu cầu tra cứu đơn hàng trong 200 ms.',
          language: 'vi',
          qualityScore: 95,
        },
      ],
      { runId: RUN_ID, router },
    );

    expect(mergeResult.autoMerges).toHaveLength(1);
    expect(mergeResult.autoMerges[0]!.primaryId).toBe('req-a');
    expect(mergeResult.autoMerges[0]!.duplicateIds).toEqual(['req-b-dup']);
    expect(mergeResult.blockedPairs.length).toBeGreaterThanOrEqual(2);
  });

  it('S8 catches lost numbers, lost negations, and weakened modality (FR-REQ-020)', async () => {
    const router = makeRouter();
    const audit = await runCoverageAndPreservation(
      [
        {
          id: 'ok-1',
          originalText: 'Hệ thống phải phản hồi trong 2 giây.',
          normalizedText: 'Hệ thống phải phản hồi trong 2000 ms.',
          language: 'vi',
        },
        {
          id: 'bad-num',
          originalText: 'Hệ thống phải lưu nhật ký trong 90 ngày.',
          normalizedText: 'Hệ thống phải lưu nhật ký.',
          language: 'vi',
        },
        {
          id: 'bad-neg',
          originalText: 'The system shall not store plaintext passwords.',
          normalizedText: 'The system shall store passwords.',
          language: 'en',
        },
        {
          id: 'bad-modal',
          originalText: 'Hệ thống phải mã hoá dữ liệu nhạy cảm.',
          normalizedText: 'Hệ thống nên mã hoá dữ liệu nhạy cảm.',
          language: 'vi',
        },
      ],
      [
        {
          id: '00000000-0000-4000-8000-000000000050',
          document_id: '00000000-0000-4000-8000-000000000060',
          ordinal: 0,
          text: 'Hệ thống phải phản hồi trong 2 giây.',
          locator: { line: 1 },
          language: 'vi',
          coverage_status: 'mapped',
          resolved_by: 'rule',
        },
      ],
      { runId: RUN_ID, router },
    );

    expect(audit.preservationChecks.find((c) => c.requirement_id === 'ok-1')?.passed).toBe(true);
    expect(audit.preservationChecks.find((c) => c.requirement_id === 'bad-num')?.lost_numbers.length).toBeGreaterThan(0);
    expect(audit.preservationChecks.find((c) => c.requirement_id === 'bad-neg')?.lost_negations).toBe(true);
    expect(audit.preservationChecks.find((c) => c.requirement_id === 'bad-modal')?.lost_modality).toBe(true);
    expect(audit.failedPreservation).toHaveLength(3);
    expect(audit.hasUncoveredSegments).toBe(false);
    expect(audit.coverageReport.coverage_pct).toBe(100);
  });
});
