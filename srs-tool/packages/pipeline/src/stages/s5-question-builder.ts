/**
 * S5: Question Builder
 *
 * Generates clarification questions from issues detected in S4.
 * Uses template library (YAML), NOT LLM by default.
 * Groups questions by topic to minimize user cognitive load.
 * Attaches default values from platform profiles.
 *
 * Tier: 0 only (template library fill-in-the-blank)
 * LLM: only when user clicks "Rephrase" button
 */

import type { Language } from '@srs-tool/schemas';
import type { LintIssue } from './s4-issue-detector.js';

export interface ClarificationQuestion {
  id: string;
  issue_id: string;
  rule_id: string;
  text: string;
  language: Language;
  suggested_values?: string[];
  topic_group: string;
  is_skippable: boolean;
}

/** Question templates keyed by rule ID */
const QUESTION_TEMPLATES: Record<string, { vi: string; en: string; topic: string; skippable: boolean }> = {
  'INCOSE-004': {
    vi: 'Yêu cầu "{subject}" cần có thước đo cụ thể. Giá trị {{metric}} mục tiêu là bao nhiêu? (ví dụ: < 200ms, ≥ 99.9%)',
    en: 'Requirement "{subject}" needs a measurable metric. What is the target value for {{metric}}? (e.g., < 200ms, ≥ 99.9%)',
    topic: 'performance',
    skippable: false,
  },
  'INCOSE-001': {
    vi: 'Từ "{{vague_term}}" trong yêu cầu có nghĩa gì cụ thể? Bạn có thể thay bằng một tiêu chí đo được không?',
    en: 'What does "{{vague_term}}" mean specifically in this requirement? Can you replace it with a measurable criterion?',
    topic: 'clarity',
    skippable: true,
  },
  'INCOSE-002': {
    vi: 'Điều kiện nào cụ thể sẽ kích hoạt hành vi này? (thay cho "nếu có thể")',
    en: 'What specific condition triggers this behavior? (replacing "if possible")',
    topic: 'condition',
    skippable: false,
  },
};

export class S5QuestionBuilder {
  /**
   * Generate clarification questions from a list of issues.
   * Tier 0: Template fill-in-the-blank. No LLM.
   */
  buildQuestions(
    issues: Array<LintIssue & { issue_id: string; requirement_text: string }>,
    language: Language,
  ): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];

    for (const issue of issues) {
      const template = QUESTION_TEMPLATES[issue.rule_id];
      if (!template) continue;

      const questionText = language === 'vi' ? template.vi : template.en;

      questions.push({
        id: crypto.randomUUID(),
        issue_id: issue.issue_id,
        rule_id: issue.rule_id,
        text: questionText,
        language,
        topic_group: template.topic,
        is_skippable: template.skippable,
        suggested_values: this.getSuggestedValues(issue.rule_id, language),
      });
    }

    // Group by topic to present related questions together
    return this.groupByTopic(questions);
  }

  private getSuggestedValues(ruleId: string, language: Language): string[] | undefined {
    // TODO: Load from platform profile YAML (packages/knowledge/profiles/)
    const defaults: Record<string, string[]> = {
      'INCOSE-004': ['< 200ms (p95)', '< 500ms (p99)', '≥ 99.9%', '≥ 99.5%'],
    };
    return defaults[ruleId];
  }

  private groupByTopic(questions: ClarificationQuestion[]): ClarificationQuestion[] {
    // Sort by topic_group for better UX grouping
    return [...questions].sort((a, b) => a.topic_group.localeCompare(b.topic_group));
  }
}
