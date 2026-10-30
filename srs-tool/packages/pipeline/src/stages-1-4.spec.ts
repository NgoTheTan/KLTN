import { describe, it, expect } from 'vitest';
import {
  S1ParseAndSegment,
  S2ExtractCandidates,
  S3ClassifyAndTag,
  S4IssueDetector,
  CoverageLedger,
  DecisionRouter,
  DEFAULT_STAGE_THRESHOLDS,
  RequirementCodeAllocator,
  runExtraction,
  runClassification,
  runIssueDetection,
  type DecisionLog,
} from './index.js';

const DOC = '11111111-1111-4111-8111-111111111111';

async function segment(content: string, contentType: any = 'text/markdown') {
  const ledger = new CoverageLedger();
  const { segments } = await new S1ParseAndSegment(ledger).process({ documentId: DOC, content, contentType });
  return { ledger, segments };
}

describe('S1 parse & segment', () => {
  it('splits headings, paragraphs and list items; tracks heading + line locators', async () => {
    const { segments, ledger } = await segment(
      ['# Yêu cầu hệ thống', '', 'Hệ thống phải gửi', 'thông báo cho người dùng.', '', '- Hệ thống phải lưu log.', '- Hệ thống phải mã hoá dữ liệu.'].join('\n'),
    );
    expect(segments.map((s) => s.text)).toEqual([
      'Hệ thống phải gửi thông báo cho người dùng.',
      'Hệ thống phải lưu log.',
      'Hệ thống phải mã hoá dữ liệu.',
    ]);
    expect(segments[0]!.locator).toMatchObject({ line: 3, heading: 'Yêu cầu hệ thống' });
    expect(segments.every((s) => s.language === 'vi')).toBe(true);
    expect(ledger.getReport().unmapped).toBe(3);
  });

  it('turns table rows into segments and ignores code fences', async () => {
    const { segments } = await segment(
      ['| ID | Requirement |', '| --- | --- |', '| FR-1 | The system shall log in users |', '', '```', 'shall not be parsed', '```'].join('\n'),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toContain('FR-1');
    expect(segments[0]!.language).toBe('en');
  });

  it('cleans emails: headers, quoted replies and signatures', async () => {
    const { segments } = await segment(
      ['From: a@b.com', 'Subject: Spec', '', 'The system must export PDF.', '', '> old quoted text must be ignored', '', '-- ', 'John'].join('\n'),
      'message/rfc822',
    );
    expect(segments.map((s) => s.text)).toEqual(['The system must export PDF.']);
  });
});

describe('S2 extraction', () => {
  const s2 = new S2ExtractCandidates();

  it('matches Vietnamese modals despite diacritics (\\b would fail)', () => {
    const c = s2.tier0({ segment_id: 's', text: 'Hệ thống phải gửi thông báo đẩy.', language: 'vi' });
    expect(c).toHaveLength(1);
    expect(c[0]!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('scores weak modals low and skips questions', () => {
    const weak = s2.tier0({ segment_id: 's', text: 'The user may change the theme.', language: 'en' });
    expect(weak[0]!.confidence).toBeLessThan(0.8);
    expect(s2.tier0({ segment_id: 's', text: 'Should the system support SSO?', language: 'en' })).toHaveLength(0);
  });

  it('never drops hinted segments silently', () => {
    const i = { segment_id: 's', text: 'The system supports offline mode.', language: 'en' as const };
    expect(s2.verdict(i, s2.tier0(i))).toBe('unclear');
    const j = { segment_id: 's', text: 'Revision history table', language: 'en' as const };
    expect(s2.verdict(j, s2.tier0(j))).toBe('not_requirement');
  });
});

describe('S3 classification', () => {
  const s3 = new S3ClassifyAndTag();

  it('detects NFR + ASR with metric and platform', () => {
    const r = s3.tier0('The system shall respond within 200 ms under 1000 concurrent users on the web dashboard.', 'en');
    expect(r.type).toBe('non-functional');
    expect(r.is_asr).toBe(true);
    expect(r.platforms).toContain('web');
    expect(r.quality_attributes).toContain('performance');
  });

  it('detects constraint, interface and assumption (vi)', () => {
    expect(s3.tier0('Hệ thống phải tuân thủ quy định GDPR.', 'vi').type).toBe('constraint');
    expect(s3.tier0('Hệ thống phải tích hợp với cổng thanh toán.', 'vi').type).toBe('interface');
    expect(s3.tier0('Giả định rằng thiết bị luôn có kết nối mạng.', 'vi').type).toBe('assumption');
  });

  it('does not match substrings (catalog != log)', () => {
    expect(s3.tier0('The system shall display the product catalog.', 'en').quality_attributes).not.toContain('maintainability');
  });
});

describe('S4 issue detection', () => {
  const s4 = new S4IssueDetector();

  it('flags vague terms in Vietnamese and missing subject', () => {
    const ids = s4.lint('Phải xử lý nhanh các yêu cầu.', 'vi').map((i) => i.rule_id);
    expect(ids).toContain('INCOSE-001');
    expect(ids).toContain('INCOSE-003');
  });

  it('accepts a well-formed requirement', () => {
    expect(s4.lint('The system shall respond within 200 ms.', 'en')).toHaveLength(0);
  });

  it('detects numeric conflicts across unit families', () => {
    const c = s4.detectNumericConflicts([
      { id: 'a', text: 'The system shall respond within 2 seconds.', platforms: ['web'] },
      { id: 'b', text: 'Response time must be at most 500 ms.', platforms: ['web'] },
      { id: 'c', text: 'Response time must be at most 500 ms.', platforms: ['iot'] },
    ]);
    expect(c.map((x) => [x.id1, x.id2])).toEqual([['a', 'b']]);
  });

  it('reports checklist gaps only for uncovered required topics', () => {
    const gaps = s4.checklistGaps(
      ['The system shall encrypt data with TLS 1.3.'],
      [
        { id: 'SEC', topic: { vi: 'Bảo mật', en: 'Security' }, keywords: { vi: ['mã hoá'], en: ['tls'] }, level: 'required', question: { vi: 'q', en: 'q' } },
        { id: 'BAK', topic: { vi: 'Sao lưu', en: 'Backup' }, keywords: { vi: ['sao lưu'], en: ['backup'] }, level: 'required', question: { vi: 'q', en: 'Which backup policy?' } },
      ],
      'en',
    );
    expect(gaps.map((g) => g.checklist_id)).toEqual(['BAK']);
  });
});

describe('S2→S4 helpers with DecisionRouter', () => {
  it('runs extraction → classification → issues and logs every decision', async () => {
    const logs: Array<Omit<DecisionLog, 'id' | 'decidedAt'>> = [];
    const router = new DecisionRouter({ mode: 'eco', stageThresholds: { ...DEFAULT_STAGE_THRESHOLDS }, onLog: async (l) => void logs.push(l) });
    const ctx = { runId: 'run-1', router };

    const { segments } = await segment('The system shall respond within 200 ms.\n\nRevision history\n\nThe user may change theme.');
    const extraction = await runExtraction(segments.map((s) => ({ id: s.id, text: s.text, language: s.language })), ctx);

    expect(extraction.map((e) => e.verdict)).toEqual(['has_candidates', 'not_requirement', 'unclear']);
    expect(extraction[2]!.status).toBe('needs_review'); // eco: no LLM escalation

    const classified = await runClassification(extraction.flatMap((e) => e.candidates), ctx);
    expect(classified[0]!.classification.type).toBe('non-functional');

    const issues = runIssueDetection(
      classified.map((c) => ({ id: c.candidate.id, text: c.candidate.text, language: c.candidate.language, platforms: c.classification.platforms })),
      { outputLanguage: 'en' },
    );
    expect(issues.perRequirement).toHaveLength(classified.length);
    expect(logs.filter((l) => l.stage === 2)).toHaveLength(3);
    expect(logs.every((l) => l.runId === 'run-1')).toBe(true);
  });
});

describe('RequirementCodeAllocator', () => {
  it('continues sequences, keeps explicit codes and never duplicates', () => {
    const a = new RequirementCodeAllocator(['FR-IOT-012']);
    expect(a.next('functional', ['iot'])).toBe('FR-IOT-013');
    expect(a.next('non-functional', ['web'])).toBe('NFR-WEB-001');
    expect(a.next('constraint', ['web', 'iot'])).toBe('CON-SYS-001');
    expect(a.next('functional', ['shared'], 'See FR-WEB-007 for login')).toBe('FR-WEB-007');
    expect(a.next('functional', ['web'], 'See FR-WEB-007 again')).toBe('FR-WEB-008');
  });
});
