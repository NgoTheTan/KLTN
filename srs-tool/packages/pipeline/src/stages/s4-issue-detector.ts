/**
 * S4: Issue Detector
 *
 * Detects: ambiguity, missing info, contradictions, terminology inconsistency.
 * Runs lint rules (INCOSE/EARS) for both vi and en.
 *
 * Three-tier:
 * - Tier 0: Deterministic lint rules, checklist diff, numeric contradiction rules
 * - Tier 1: Embedding pair matching, NLI for contradiction detection
 * - Tier 2: LLM for ambiguous pairs (Thorough mode only)
 */

import type { IssueKind, IssueSeverity, Language, Platform } from '@srs-tool/schemas';
import { countWord, wordsRegex } from '../text.js';

export interface LintIssue {
  rule_id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  message: string;
  message_vi?: string;
}

/** Minimal checklist item shape (compatible with @srs-tool/knowledge ChecklistItem). */
export interface ChecklistTopic {
  id: string;
  topic: { vi: string; en: string };
  keywords: { vi: string[]; en: string[] };
  quality?: string;
  level: 'required' | 'recommended' | 'conditional';
  question: { vi: string; en: string };
  platform?: string;
}

export interface ChecklistGap {
  checklist_id: string;
  level: ChecklistTopic['level'];
  platform?: string;
  message: string;
  question: string;
}

export interface ConflictPair {
  id1: string;
  id2: string;
  attribute: string;
  values: [string, string];
  confidence: number;
  message: string;
}

export interface RequirementForConflict {
  id: string;
  text: string;
  platforms?: Platform[];
}

// INCOSE/EARS Lint Rules

interface LintRule {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  description: string;
  check: (text: string, language: Language) => boolean;
  message: (language: Language) => string;
}

const MODAL_FOR_SUBJECT = wordsRegex(['shall', 'must', 'should', 'will', 'phải', 'cần', 'nên', 'không được']);
const VAGUE_EN = wordsRegex(['fast', 'slow', 'user-friendly', 'user friendly', 'appropriate', 'adequate', 'sufficient', 'efficient', 'reasonable', 'flexible', 'easy', 'intuitive', 'simple', 'modern', 'latest', 'best', 'good', 'quickly', 'shortly', 'nearby', 'various']);
const VAGUE_VI = wordsRegex(['nhanh', 'chậm', 'thân thiện', 'phù hợp', 'đủ', 'hiệu quả', 'hợp lý', 'linh hoạt', 'dễ dàng', 'dễ dùng', 'đơn giản', 'hiện đại', 'tốt', 'gần đây', 'nhiều', 'ổn định']);
const ESCAPE_EN = wordsRegex(['if possible', 'as far as possible', 'where possible', 'to the extent possible', 'should be able to']);
const ESCAPE_VI = wordsRegex(['nếu có thể', 'trong phạm vi có thể', 'có thể khi', 'tùy điều kiện', 'tuỳ điều kiện']);
const OPEN_EN = /(?<![\p{L}\p{N}])(etc\.?|and so on|including but not limited to|and others?)(?![\p{L}\p{N}])/iu;
const OPEN_VI = /(v\.v\.?|vân vân|và các loại khác|bao gồm nhưng không giới hạn|và nhiều hơn nữa)/iu;
const NFR_WORDS = wordsRegex(['performance', 'availability', 'security', 'reliability', 'scalability', 'latency', 'throughput', 'khả dụng', 'bảo mật', 'hiệu năng', 'độ tin cậy', 'mở rộng']);
const HAS_NUMBER = /\d+(?:[.,]\d+)?\s*(ms|s|%|mb|gb|rpm|rps|tps|req\/s|users?|người dùng|phút|giây|mili|giờ|hours?|minutes?|seconds?)/i;
const USER_STORY = /^(as\s+an?\s|là\s|với tư cách là\s)/i;

const LINT_RULES: LintRule[] = [
  {
    id: 'EARS-001',
    kind: 'unnormalized',
    severity: 'error',
    description: 'Multiple "shall/phải" in one requirement',
    check: (text, lang) => (lang === 'vi' ? countWord(text, 'phải') : countWord(text, 'shall')) > 1,
    message: (lang) => lang === 'vi'
      ? 'Yêu cầu chứa nhiều "phải" — hãy tách thành nhiều yêu cầu'
      : 'Requirement contains multiple "shall" — split into separate requirements',
  },
  {
    id: 'INCOSE-001',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Vague/ambiguous terms',
    check: (text, lang) => (lang === 'vi' ? VAGUE_VI : VAGUE_EN).test(text),
    message: (lang) => lang === 'vi'
      ? 'Chứa từ mơ hồ — hãy thay bằng tiêu chí đo được'
      : 'Contains vague term — replace with measurable criterion',
  },
  {
    id: 'INCOSE-002',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Escape clause',
    check: (text, lang) => (lang === 'vi' ? ESCAPE_VI : ESCAPE_EN).test(text),
    message: (lang) => lang === 'vi'
      ? 'Chứa điều khoản thoát — xác định điều kiện cụ thể'
      : 'Contains escape clause — specify concrete condition',
  },
  {
    id: 'INCOSE-003',
    kind: 'incomplete',
    severity: 'error',
    description: 'No subject (system/actor) before the modal verb',
    check: (text) => {
      if (USER_STORY.test(text.trim())) return false;
      const m = MODAL_FOR_SUBJECT.exec(text);
      if (!m) return false; // no modal: not a normative sentence, other rules cover it
      const before = text.slice(0, m.index).replace(/^(when|while|where|if|khi|trong khi|nếu)\b.*?,/iu, '').trim();
      return before.length < 2;
    },
    message: (lang) => lang === 'vi'
      ? 'Thiếu chủ thể rõ ràng (hệ thống, actor)'
      : 'Missing explicit subject (system, actor)',
  },
  {
    id: 'INCOSE-004',
    kind: 'incomplete',
    severity: 'warning',
    description: 'NFR missing measurable metric',
    check: (text) => NFR_WORDS.test(text) && !HAS_NUMBER.test(text),
    message: (lang) => lang === 'vi'
      ? 'Yêu cầu phi chức năng thiếu thước đo (số liệu và đơn vị)'
      : 'Non-functional requirement missing measurable metric (number + unit)',
  },
  {
    id: 'INCOSE-005',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Open-ended list',
    check: (text, lang) => (lang === 'vi' ? OPEN_VI : OPEN_EN).test(text),
    message: (lang) => lang === 'vi'
      ? 'Danh sách mở (v.v.) — hãy liệt kê đầy đủ hoặc định nghĩa rõ'
      : 'Open-ended list (etc.) — enumerate fully or define clearly',
  },
];

// Numeric contradiction: attribute detection

const METRIC_ATTRIBUTES: Array<{ attribute: string; re: RegExp }> = [
  { attribute: 'response_time', re: wordsRegex(['response time', 'latency', 'thời gian phản hồi', 'độ trễ', 'phản hồi trong', 'respond within']) },
  { attribute: 'availability', re: wordsRegex(['availability', 'uptime', 'khả dụng', 'thời gian hoạt động']) },
  { attribute: 'concurrent_users', re: wordsRegex(['concurrent users', 'simultaneous users', 'người dùng đồng thời']) },
  { attribute: 'throughput', re: wordsRegex(['throughput', 'thông lượng', 'requests per second']) },
  { attribute: 'retention', re: wordsRegex(['retention', 'retain', 'lưu trữ', 'lưu giữ']) },
];

const VALUE_RE = /(\d+(?:[.,]\d+)?)\s*(ms|milliseconds?|mili giây|seconds?|giây|s|minutes?|phút|hours?|giờ|%|users?|người dùng|rps|tps|req\/s)/i;

const UNIT_TO_BASE: Record<string, { unit: string; factor: number }> = {
  ms: { unit: 'ms', factor: 1 }, millisecond: { unit: 'ms', factor: 1 }, milliseconds: { unit: 'ms', factor: 1 }, 'mili giây': { unit: 'ms', factor: 1 },
  s: { unit: 'ms', factor: 1000 }, second: { unit: 'ms', factor: 1000 }, seconds: { unit: 'ms', factor: 1000 }, giây: { unit: 'ms', factor: 1000 },
  minute: { unit: 'ms', factor: 60000 }, minutes: { unit: 'ms', factor: 60000 }, phút: { unit: 'ms', factor: 60000 },
  hour: { unit: 'ms', factor: 3600000 }, hours: { unit: 'ms', factor: 3600000 }, giờ: { unit: 'ms', factor: 3600000 },
  '%': { unit: '%', factor: 1 },
  user: { unit: 'users', factor: 1 }, users: { unit: 'users', factor: 1 }, 'người dùng': { unit: 'users', factor: 1 },
  rps: { unit: 'rps', factor: 1 }, tps: { unit: 'rps', factor: 1 }, 'req/s': { unit: 'rps', factor: 1 },
};

interface ParsedMetric { attribute: string; value: number; unit: string; display: string }

function parseMetric(text: string): ParsedMetric | null {
  const attr = METRIC_ATTRIBUTES.find((a) => a.re.test(text));
  if (!attr) return null;
  const v = VALUE_RE.exec(text);
  if (!v) return null;
  const conv = UNIT_TO_BASE[v[2]!.toLowerCase()];
  if (!conv) return null;
  const num = parseFloat(v[1]!.replace(',', '.'));
  return { attribute: attr.attribute, value: num * conv.factor, unit: conv.unit, display: `${v[1]} ${v[2]}` };
}

export class S4IssueDetector {
  /**
   * Run all deterministic lint rules against a requirement text.
   * Tier 0 only — fast and fully explainable.
   */
  lint(text: string, language: Language): LintIssue[] {
    return LINT_RULES
      .filter((rule) => rule.check(text, language))
      .map((rule) => ({
        rule_id: rule.id,
        kind: rule.kind,
        severity: rule.severity,
        message: rule.message(language),
      }));
  }

  /**
   * Calculate quality score (0-100) based on lint results.
   * Deduct points for errors and warnings.
   */
  qualityScore(issues: LintIssue[]): number {
    let score = 100;
    for (const issue of issues) {
      if (issue.severity === 'error') score -= 20;
      else if (issue.severity === 'warning') score -= 10;
    }
    return Math.max(0, score);
  }

  /**
   * Tier 0 contradiction detection: two requirements that constrain the same
   * measurable attribute (same unit family) with different values on overlapping
   * platforms. Confidence reflects how explicit the overlap is.
   */
  detectNumericConflicts(requirements: RequirementForConflict[]): ConflictPair[] {
    const parsed = requirements
      .map((r) => ({ r, m: parseMetric(r.text) }))
      .filter((x): x is { r: RequirementForConflict; m: ParsedMetric } => x.m !== null);

    const conflicts: ConflictPair[] = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i]!;
        const b = parsed[j]!;
        if (a.m.attribute !== b.m.attribute || a.m.unit !== b.m.unit) continue;
        if (Math.abs(a.m.value - b.m.value) < 1e-9) continue;
        const pa = a.r.platforms ?? ['shared'];
        const pb = b.r.platforms ?? ['shared'];
        const overlap = pa.includes('shared') || pb.includes('shared') || pa.some((p) => pb.includes(p));
        if (!overlap) continue;
        conflicts.push({
          id1: a.r.id,
          id2: b.r.id,
          attribute: a.m.attribute,
          values: [a.m.display, b.m.display],
          confidence: 0.85,
          message: `Conflicting ${a.m.attribute}: "${a.m.display}" vs "${b.m.display}"`,
        });
      }
    }
    return conflicts;
  }

  /**
   * Tier 0 checklist diff: topics from the platform checklist that no requirement mentions.
   * Only 'required' items are reported as gaps; others are returned with level preserved
   * so callers can filter. 'conditional' items are skipped (need project context).
   */
  checklistGaps(requirementTexts: string[], checklist: ChecklistTopic[], language: Language): ChecklistGap[] {
    const corpus = requirementTexts.join('\n');
    const gaps: ChecklistGap[] = [];
    for (const item of checklist) {
      if (item.level === 'conditional') continue;
      const words = [...(item.keywords.vi ?? []), ...(item.keywords.en ?? [])];
      if (words.length > 0 && wordsRegex(words).test(corpus)) continue;
      gaps.push({
        checklist_id: item.id,
        level: item.level,
        platform: item.platform,
        message: language === 'vi'
          ? `Chưa có yêu cầu nào đề cập: ${item.topic.vi}`
          : `No requirement covers: ${item.topic.en}`,
        question: language === 'vi' ? item.question.vi : item.question.en,
      });
    }
    return gaps;
  }

  /** Tier 1: Detect contradictions using embedding pairs (placeholder). */
  async detectContradictions(_requirements: Array<{ id: string; text: string }>): Promise<Array<{ id1: string; id2: string; confidence: number }>> {
    // TODO: Implement using pgvector similarity + NLI model
    return [];
  }
}
