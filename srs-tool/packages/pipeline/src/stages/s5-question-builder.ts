/**
 * S5: Question Builder
 *
 * Generates slot-filled bilingual clarification questions from S4 issues:
 * - EARS-001 (multiple shall/phải)
 * - INCOSE-001..005 (vague words, escape clauses, missing subject, missing metric, open lists)
 * - CONFLICT-NUM (surfaces the exact conflicting values as selectable options)
 * - CHECKLIST-* (surfaces platform checklist questions + default suggestions with inferred origin warning)
 *
 * Tier: 0 only (deterministic template slot-filling + YAML platform defaults, 0 LLM tokens).
 */

import type { Language } from '@srs-tool/schemas';
import type { LintIssue } from './s4-issue-detector.js';
import { wordsRegex } from '../text.js';

export interface ClarificationQuestion {
  id: string;
  issue_id: string;
  rule_id: string;
  text: string;
  language: Language;
  suggested_values?: string[];
  proposed_value?: string;
  topic_group: string;
  is_skippable: boolean;
}

export interface IssueForQuestion extends LintIssue {
  issue_id: string;
  requirement_text: string;
}

const VAGUE_WORDS_VI = [
  'nhanh', 'chậm', 'thân thiện', 'phù hợp', 'đủ', 'hiệu quả', 'hợp lý',
  'linh hoạt', 'dễ dàng', 'dễ dùng', 'đơn giản', 'hiện đại', 'tốt', 'gần đây', 'nhiều', 'ổn định',
];
const VAGUE_WORDS_EN = [
  'fast', 'slow', 'user-friendly', 'user friendly', 'appropriate', 'adequate', 'sufficient',
  'efficient', 'reasonable', 'flexible', 'easy', 'intuitive', 'simple', 'modern', 'latest',
  'best', 'good', 'quickly', 'shortly', 'nearby', 'various',
];

interface TemplateDef {
  vi: string;
  en: string;
  topic: string;
  skippable: boolean;
}

const QUESTION_TEMPLATES: Record<string, TemplateDef> = {
  'EARS-001': {
    vi: 'Yêu cầu "{subject}" đang ghép nhiều mệnh đề bắt buộc ("phải"). Bạn muốn tách thành các yêu cầu độc lập như thế nào?',
    en: 'Requirement "{subject}" combines multiple mandatory ("shall") clauses. How should it be split into atomic requirements?',
    topic: 'structure',
    skippable: false,
  },
  'INCOSE-001': {
    vi: 'Từ mơ hồ "{{vague_term}}" trong "{subject}" cần được lượng hoá. Tiêu chí đo lường cụ thể là gì?',
    en: 'Vague term "{{vague_term}}" in "{subject}" needs quantification. What is the concrete measurable criterion?',
    topic: 'clarity',
    skippable: true,
  },
  'INCOSE-002': {
    vi: 'Yêu cầu "{subject}" dùng mệnh đề thoát hiểm ("nếu có thể" / "tuỳ điều kiện"). Điều kiện kích hoạt chính xác là gì?',
    en: 'Requirement "{subject}" contains an escape clause ("if possible"). What is the exact triggering condition?',
    topic: 'condition',
    skippable: false,
  },
  'INCOSE-003': {
    vi: 'Chủ thể thực hiện hành động trong "{subject}" là thành phần hay vai trò nào (ví dụ: Hệ thống, API, Quản trị viên)?',
    en: 'Which explicit system component or actor is responsible for "{subject}" (e.g., System, API Server, Administrator)?',
    topic: 'actor',
    skippable: false,
  },
  'INCOSE-004': {
    vi: 'Yêu cầu phi chức năng "{subject}" chưa có con số và đơn vị đo. Mức mục tiêu cụ thể là bao nhiêu?',
    en: 'Non-functional requirement "{subject}" lacks a numeric target and unit. What is the target threshold?',
    topic: 'performance',
    skippable: false,
  },
  'INCOSE-005': {
    vi: 'Danh sách mở ("v.v." / "etc.") trong "{subject}" gồm đầy đủ những mục nào trong phạm vi phiên bản này?',
    en: 'What is the complete, closed list of items replacing "etc." in "{subject}" for this release scope?',
    topic: 'completeness',
    skippable: true,
  },
};

export class S5QuestionBuilder {
  /**
   * Generate clarification questions from S4 issues.
   * Tier 0: Template fill-in-the-blank + platform defaults. Zero LLM calls.
   */
  buildQuestions(
    issues: IssueForQuestion[],
    language: Language,
    platformDefaults: Record<string, string | number | boolean> = {},
  ): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];

    for (const issue of issues) {
      // 1. Numeric Conflict (CONFLICT-NUM)
      if (issue.rule_id === 'CONFLICT-NUM') {
        const pairMatch = /"([^"]+)"\s+vs\s+"([^"]+)"/i.exec(issue.message);
        const valA = pairMatch?.[1];
        const valB = pairMatch?.[2];
        const options = valA && valB ? [valA, valB] : undefined;
        const text =
          language === 'vi'
            ? `Phát hiện mâu thuẫn số liệu (${valA ?? '?'} so với ${valB ?? '?'}) ở yêu cầu "${this.shortSubject(issue.requirement_text)}". Giá trị nào là chuẩn chính thức?`
            : `Numeric conflict detected (${valA ?? '?'} vs ${valB ?? '?'}) in "${this.shortSubject(issue.requirement_text)}". Which value is authoritative?`;

        questions.push({
          id: crypto.randomUUID(),
          issue_id: issue.issue_id,
          rule_id: issue.rule_id,
          text,
          language,
          suggested_values: options,
          proposed_value: valA,
          topic_group: 'conflict',
          is_skippable: false,
        });
        continue;
      }

      // 2. Platform Checklist Gaps (CHECKLIST-*)
      if (issue.rule_id.startsWith('CHECKLIST-') || issue.rule_id.startsWith('CHECKLIST:')) {
        const checklistId = issue.rule_id.replace(/^CHECKLIST[-:]/, '');
        const parts = issue.message.split(' — ');
        const extractedQuestion = parts.length > 1 ? parts.slice(1).join(' — ').trim() : issue.message;
        const suggestions = this.checklistSuggestions(checklistId, language, platformDefaults);

        questions.push({
          id: crypto.randomUUID(),
          issue_id: issue.issue_id,
          rule_id: issue.rule_id,
          text: extractedQuestion,
          language,
          suggested_values: suggestions,
          proposed_value: suggestions?.[0],
          topic_group: `checklist:${checklistId.split('-')[0] ?? 'shared'}`,
          is_skippable: true,
        });
        continue;
      }

      // 3. Standard INCOSE / EARS Lint Templates
      const template = QUESTION_TEMPLATES[issue.rule_id];
      if (!template) continue;

      const subject = this.shortSubject(issue.requirement_text);
      const vagueTerm = this.extractVagueTerm(issue.requirement_text);
      const rawTemplate = language === 'vi' ? template.vi : template.en;
      const filledText = rawTemplate
        .replace(/\{subject\}/g, subject)
        .replace(/\{\{vague_term\}\}/g, vagueTerm)
        .replace(/\{\{metric\}\}/g, language === 'vi' ? 'chỉ số mục tiêu' : 'target metric');

      const suggestions = this.getSuggestedValues(issue.rule_id, issue.requirement_text, language, platformDefaults);

      questions.push({
        id: crypto.randomUUID(),
        issue_id: issue.issue_id,
        rule_id: issue.rule_id,
        text: filledText,
        language,
        topic_group: template.topic,
        is_skippable: template.skippable,
        suggested_values: suggestions,
        proposed_value: suggestions?.[0],
      });
    }

    return this.groupByTopic(questions);
  }

  private shortSubject(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return 'N/A';
    return clean.length <= 80 ? clean : `${clean.slice(0, 77)}...`;
  }

  private extractVagueTerm(text: string): string {
    for (const word of [...VAGUE_WORDS_VI, ...VAGUE_WORDS_EN]) {
      if (wordsRegex([word]).test(text)) return word;
    }
    return 'nhanh / phù hợp';
  }

  private getSuggestedValues(
    ruleId: string,
    reqText: string,
    language: Language,
    defaults: Record<string, string | number | boolean>,
  ): string[] | undefined {
    const p95 = defaults['response_time_p95_ms'] ?? 200;
    const p99 = defaults['response_time_p99_ms'] ?? 500;
    const avail = defaults['availability_pct'] ?? 99.9;

    if (ruleId === 'INCOSE-004' || ruleId === 'INCOSE-001') {
      if (/khả dụng|uptime|availability/i.test(reqText)) {
        return [`>= ${avail}%`, '>= 99.5%', '>= 99.95%'];
      }
      if (/đồng thời|concurrent|load|tải/i.test(reqText)) {
        const maxUsers = defaults['max_concurrent_users'] ?? 1000;
        return language === 'vi'
          ? [`>= ${maxUsers} người dùng đồng thời`, '>= 500 người dùng đồng thời']
          : [`>= ${maxUsers} concurrent users`, '>= 500 concurrent users'];
      }
      return language === 'vi'
        ? [`<= ${p95} ms (p95)`, `<= ${p99} ms (p99)`, `>= ${avail}%`]
        : [`<= ${p95} ms (p95)`, `<= ${p99} ms (p99)`, `>= ${avail}%`];
    }

    if (ruleId === 'INCOSE-003') {
      return language === 'vi'
        ? ['Hệ thống', 'Máy chủ API', 'Ứng dụng Web', 'Người dùng đã đăng nhập']
        : ['The system', 'The API server', 'The web application', 'Authenticated user'];
    }

    return undefined;
  }

  private checklistSuggestions(
    checklistId: string,
    language: Language,
    defaults: Record<string, string | number | boolean>,
  ): string[] | undefined {
    if (checklistId.includes('perf')) {
      const p95 = defaults['response_time_p95_ms'] ?? 200;
      return language === 'vi'
        ? [`Thời gian phản hồi API p95 không quá ${p95} ms`, 'Thời gian tải trang LCP dưới 2.5 giây']
        : [`API p95 response time shall not exceed ${p95} ms`, 'Page load LCP shall be under 2.5 seconds'];
    }
    if (checklistId.includes('avail') || checklistId.includes('backup')) {
      const rpo = defaults['backup_rpo_hours'] ?? 24;
      const rto = defaults['backup_rto_hours'] ?? 4;
      return language === 'vi'
        ? [`Sao lưu tự động hằng ngày, RPO <= ${rpo} giờ, RTO <= ${rto} giờ`]
        : [`Automated daily backups with RPO <= ${rpo} hours and RTO <= ${rto} hours`];
    }
    if (checklistId.includes('auth')) {
      const timeout = defaults['session_timeout_min'] ?? 30;
      return language === 'vi'
        ? [`Đăng nhập OAuth 2.0 / JWT, phiên hết hạn sau ${timeout} phút không hoạt động`]
        : [`OAuth 2.0 / JWT authentication with ${timeout}-minute idle session timeout`];
    }
    return undefined;
  }

  private groupByTopic(questions: ClarificationQuestion[]): ClarificationQuestion[] {
    return [...questions].sort((a, b) => a.topic_group.localeCompare(b.topic_group));
  }
}
