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

import type { IssueKind, IssueSeverity, Language } from '@srs-tool/schemas';

export interface LintIssue {
  rule_id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  message: string;
  message_vi?: string;
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

const LINT_RULES: LintRule[] = [
  {
    id: 'EARS-001',
    kind: 'unnormalized',
    severity: 'error',
    description: 'Multiple "shall/phải" in one requirement',
    check: (text, lang) => {
      const count = lang === 'vi'
        ? (text.match(/\bphải\b/g) ?? []).length
        : (text.match(/\bshall\b/gi) ?? []).length;
      return count > 1;
    },
    message: (lang) => lang === 'vi'
      ? 'Yêu cầu chứa nhiều "phải" — hãy tách thành nhiều yêu cầu'
      : 'Requirement contains multiple "shall" — split into separate requirements',
  },
  {
    id: 'INCOSE-001',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Vague/ambiguous terms',
    check: (text, lang) => {
      const vagueEn = /\b(fast|slow|user.?friendly|appropriate|adequate|sufficient|efficient|reasonable|flexible|easy|intuitive|simple|modern|latest|best|good|quickly|shortly|nearby|various)\b/i;
      const vagueVi = /\b(nhanh|chậm|thân thiện|phù hợp|đủ|hiệu quả|hợp lý|linh hoạt|dễ|đơn giản|hiện đại|tốt|gần đây|nhiều|các)\b/i;
      return lang === 'vi' ? vagueVi.test(text) : vagueEn.test(text);
    },
    message: (lang) => lang === 'vi'
      ? 'Chứa từ mơ hồ — hãy thay bằng tiêu chí đo được'
      : 'Contains vague term — replace with measurable criterion',
  },
  {
    id: 'INCOSE-002',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Escape clause',
    check: (text, lang) => {
      const escapeEn = /\b(if possible|as far as possible|where possible|to the extent possible|should be able to)\b/i;
      const escapeVi = /\b(nếu có thể|trong phạm vi có thể|có thể khi|tùy điều kiện)\b/i;
      return lang === 'vi' ? escapeVi.test(text) : escapeEn.test(text);
    },
    message: (lang) => lang === 'vi'
      ? 'Chứa điều khoản thoát — xác định điều kiện cụ thể'
      : 'Contains escape clause — specify concrete condition',
  },
  {
    id: 'INCOSE-003',
    kind: 'incomplete',
    severity: 'error',
    description: 'No subject (system/actor)',
    check: (text, lang) => {
      // Simplified: check if text starts with a subject indicator
      const subjectEn = /^(the\s+\w+|when|while|where|if)/i;
      const subjectVi = /^(hệ thống|khi|trong khi|nếu|với|ứng dụng|máy chủ)/i;
      return !(lang === 'vi' ? subjectVi : subjectEn).test(text.trim());
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
    check: (text, _lang) => {
      // If it looks like a non-functional requirement but has no numbers
      const nfrKeywords = /\b(performance|availability|security|reliability|scalability|latency|throughput|khả dụng|bảo mật|hiệu năng)\b/i;
      const hasNumber = /\d+\s*(ms|s|%|mb|gb|rpm|rps|tps|req\/s|users?|phút|giây|mili)/i;
      return nfrKeywords.test(text) && !hasNumber.test(text);
    },
    message: (lang) => lang === 'vi'
      ? 'Yêu cầu phi chức năng thiếu thước đo (số liệu và đơn vị)'
      : 'Non-functional requirement missing measurable metric (number + unit)',
  },
  {
    id: 'INCOSE-005',
    kind: 'ambiguous',
    severity: 'warning',
    description: 'Open-ended list',
    check: (text, lang) => {
      const openEn = /\b(etc\.?|and so on|including but not limited to|and others?)\b/i;
      const openVi = /\b(v\.v\.?|và các loại khác|bao gồm nhưng không giới hạn|và nhiều hơn nữa)\b/i;
      return lang === 'vi' ? openVi.test(text) : openEn.test(text);
    },
    message: (lang) => lang === 'vi'
      ? 'Danh sách mở (v.v.) — hãy liệt kê đầy đủ hoặc định nghĩa rõ'
      : 'Open-ended list (etc.) — enumerate fully or define clearly',
  },
];

export class S4IssueDetector {
  /**
   * Run all deterministic lint rules against a requirement text.
   * Tier 0 only — fast and fully explainable.
   */
  lint(text: string, language: Language): LintIssue[] {
    return LINT_RULES
      .filter(rule => rule.check(text, language))
      .map(rule => ({
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

  /** Tier 1: Detect contradictions using embedding pairs (placeholder). */
  async detectContradictions(_requirements: Array<{ id: string; text: string }>): Promise<Array<{ id1: string; id2: string; confidence: number }>> {
    // TODO: Implement using pgvector similarity + NLI model
    return [];
  }
}
