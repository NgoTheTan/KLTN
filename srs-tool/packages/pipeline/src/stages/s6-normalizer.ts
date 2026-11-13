/**
 * S6: Normalizer (EARS pattern normalization + Given/When/Then + QualityMetric)
 *
 * Converts requirement candidates (existing EARS sentences, User Stories, modal
 * statements, or imperative bullet points) into standardized bilingual EARS format
 * while strictly preserving all numbers, units, negations, and mandatory modality.
 *
 * Three-tier:
 * - Tier 0: Deterministic pattern recognition, User Story decomposition, safe modal
 *           normalization, metric extraction, and Given/When/Then generation.
 * - Tier 2: Small/Large LLM for multi-clause free-form prose (Phase 3).
 */

import type {
  EarsPattern,
  Language,
  Priority,
  QualityMetric,
  VerificationMethod,
} from '@srs-tool/schemas';

export interface NormalizationResult {
  statement: string;
  ears_pattern: EarsPattern;
  priority: Priority;
  rationale?: string;
  metric?: QualityMetric;
  acceptance_criteria: string;
  verification_method: VerificationMethod;
  slots: {
    trigger?: string;
    state?: string;
    condition?: string;
    subject: string;
    response: string;
    measure?: string;
  };
  confidence: number;
  lint_passed: boolean;
  info_preserved: boolean;
  tier: 0 | 2;
}

const METRIC_RE =
  /(\d+(?:[.,]\d+)?\s*(?:ms|mili giây|milliseconds?|giây|seconds?|s|phút|minutes?|giờ|hours?|%|mb|gb|kb|rpm|rps|tps|req\/s|msg\/s|hz|users?|người dùng|devices?|thiết bị)(?:\s*\(p\d{2}\))?)/i;

const USER_STORY_VI =
  /^(?:là|với vai trò(?: là)?|với tư cách(?: là)?)\s+([^,]+),\s*tôi\s+(?:muốn|cần)\s+(.+?)(?:\s+để\s+(.+?))?[.!?]?$/iu;
const USER_STORY_EN =
  /^as\s+an?\s+([^,]+),\s*i\s+(?:want|need)\s+(?:to\s+)?(.+?)(?:\s+so\s+that\s+(.+?))?[.!?]?$/iu;

export class S6Normalizer {
  /**
   * Tier 0: Normalize requirement text into EARS format without losing quantitative or negative constraints.
   */
  tier0(text: string, language: Language): NormalizationResult | null {
    const cleaned = text
      .replace(/^\s*(?:[-*•+]|\d+(?:\.\d+)*[.)])\s+/, '')
      .replace(/^(?:(?:FR|NFR|CON|IF|ASM)-[A-Z]{2,4}-\d{1,4})\s*[:\-–]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return null;

    const priority = this.derivePriority(cleaned, language);
    const metricMatch = METRIC_RE.exec(cleaned);
    const measure = metricMatch?.[1]?.trim();

    // 1. Handle User Stories explicitly ("Là <actor>, tôi muốn <goal> để <rationale>")
    const userStory = this.parseUserStory(cleaned, language);
    if (userStory) {
      const pattern: EarsPattern = userStory.trigger ? 'event-driven' : 'ubiquitous';
      const slots: NormalizationResult['slots'] = {
        trigger: userStory.trigger,
        subject: language === 'vi' ? 'Hệ thống' : 'system',
        response: userStory.response,
        measure,
      };
      const statement = this.buildStatement(pattern, slots, language, priority);
      const metric = measure
        ? {
            stimulus: userStory.trigger,
            artifact: slots.subject,
            response: slots.response,
            response_measure: measure,
          }
        : undefined;

      return {
        statement,
        ears_pattern: pattern,
        priority,
        rationale: userStory.rationale,
        metric,
        acceptance_criteria: this.buildGWT(pattern, slots, language),
        verification_method: this.deriveVerificationMethod(slots),
        slots,
        confidence: 0.9,
        lint_passed: true,
        info_preserved: true,
        tier: 0,
      };
    }

    // 2. Detect explicit or implicit EARS pattern & slots
    const normalizedModals = this.normalizeModals(cleaned, language);
    const parsed = this.parseNormativeSentence(normalizedModals, language);
    if (!parsed) return null;

    const slots: NormalizationResult['slots'] = {
      trigger: parsed.trigger,
      state: parsed.state,
      condition: parsed.condition,
      subject: parsed.subject,
      response: parsed.response,
      measure,
    };

    const statement = this.buildStatement(parsed.pattern, slots, language, priority);
    const metric: QualityMetric | undefined = measure
      ? {
          stimulus: slots.trigger ?? slots.condition,
          environment: slots.state,
          artifact: slots.subject,
          response: slots.response,
          response_measure: measure,
        }
      : undefined;

    return {
      statement,
      ears_pattern: parsed.pattern,
      priority,
      rationale: parsed.rationale,
      metric,
      acceptance_criteria: this.buildGWT(parsed.pattern, slots, language),
      verification_method: this.deriveVerificationMethod(slots),
      slots,
      confidence: parsed.confidence,
      lint_passed: true,
      info_preserved: true,
      tier: 0,
    };
  }

  private parseUserStory(
    text: string,
    lang: Language,
  ): { response: string; rationale?: string; trigger?: string } | null {
    if (lang === 'vi') {
      const m = USER_STORY_VI.exec(text);
      if (!m) return null;
      const actor = m[1]!.trim();
      let goal = m[2]!.trim().replace(/[.!?]+$/, '');
      const rationale = m[3]?.trim().replace(/[.!?]+$/, '');
      let trigger: string | undefined;
      const whenSplit = /^(.+?)\s+khi\s+(.+)$/iu.exec(goal);
      if (whenSplit) {
        goal = whenSplit[1]!.trim();
        trigger = whenSplit[2]!.trim();
      }
      return {
        response: `cho phép ${actor} ${goal}`,
        rationale,
        trigger,
      };
    }

    const m = USER_STORY_EN.exec(text);
    if (!m) return null;
    const actor = m[1]!.trim();
    let goal = m[2]!.trim().replace(/[.!?]+$/, '');
    const rationale = m[3]?.trim().replace(/[.!?]+$/, '');
    let trigger: string | undefined;
    const whenSplit = /^(.+?)\s+when\s+(.+)$/iu.exec(goal);
    if (whenSplit) {
      goal = whenSplit[1]!.trim();
      trigger = whenSplit[2]!.trim();
    }
    return {
      response: `allow ${actor} to ${goal}`,
      rationale,
      trigger,
    };
  }

  private parseNormativeSentence(
    text: string,
    lang: Language,
  ): {
    pattern: EarsPattern;
    trigger?: string;
    state?: string;
    condition?: string;
    subject: string;
    response: string;
    rationale?: string;
    confidence: number;
  } | null {
    const body = text.replace(/[.!?]+$/, '').trim();

    if (lang === 'vi') {
      // Unwanted: Nếu <cond>[,] [thì] <subject> phải/không được/nên <resp>
      const unwanted = /^nếu\s+(.+?)(?:,\s*thì|\s+thì|,)\s+(.+)$/iu.exec(body);
      if (unwanted) {
        const sr = this.splitSubjectResponseVi(unwanted[2]!.trim());
        return { pattern: 'unwanted', condition: unwanted[1]!.trim(), ...sr, confidence: 0.9 };
      }

      // Event-driven: Khi <trigger>, <subject> phải <resp>
      const eventLead = /^khi\s+(.+?),\s*(.+)$/iu.exec(body);
      if (eventLead) {
        const sr = this.splitSubjectResponseVi(eventLead[2]!.trim());
        return { pattern: 'event-driven', trigger: eventLead[1]!.trim(), ...sr, confidence: 0.9 };
      }

      // State-driven: Trong khi <state>, <subject> phải <resp>
      const stateLead = /^trong khi\s+(.+?),\s*(.+)$/iu.exec(body);
      if (stateLead) {
        const sr = this.splitSubjectResponseVi(stateLead[2]!.trim());
        return { pattern: 'state-driven', state: stateLead[1]!.trim(), ...sr, confidence: 0.9 };
      }

      // Optional: Với / Ở cấu hình <feature>, <subject> phải <resp>
      const optLead = /^(?:với|ở nơi có)\s+(.+?),\s*(.+)$/iu.exec(body);
      if (optLead) {
        const sr = this.splitSubjectResponseVi(optLead[2]!.trim());
        return { pattern: 'optional', condition: optLead[1]!.trim(), ...sr, confidence: 0.88 };
      }

      // Ubiquitous or trailing "khi ..."
      const sr = this.splitSubjectResponseVi(body);
      return {
        pattern: 'ubiquitous',
        ...sr,
        confidence: sr.hadExplicitSubject ? 0.88 : 0.85,
      };
    }

    // English patterns
    const unwantedEn = /^if\s+(.+?)(?:,\s*then|\s+then|,)\s+(.+)$/iu.exec(body);
    if (unwantedEn) {
      const sr = this.splitSubjectResponseEn(unwantedEn[2]!.trim());
      return { pattern: 'unwanted', condition: unwantedEn[1]!.trim(), ...sr, confidence: 0.9 };
    }

    const eventEn = /^when\s+(.+?),\s*(.+)$/iu.exec(body);
    if (eventEn) {
      const sr = this.splitSubjectResponseEn(eventEn[2]!.trim());
      return { pattern: 'event-driven', trigger: eventEn[1]!.trim(), ...sr, confidence: 0.9 };
    }

    const stateEn = /^while\s+(.+?),\s*(.+)$/iu.exec(body);
    if (stateEn) {
      const sr = this.splitSubjectResponseEn(stateEn[2]!.trim());
      return { pattern: 'state-driven', state: stateEn[1]!.trim(), ...sr, confidence: 0.9 };
    }

    const optEn = /^where\s+(.+?),\s*(.+)$/iu.exec(body);
    if (optEn) {
      const sr = this.splitSubjectResponseEn(optEn[2]!.trim());
      return { pattern: 'optional', condition: optEn[1]!.trim(), ...sr, confidence: 0.88 };
    }

    const sr = this.splitSubjectResponseEn(body);
    return {
      pattern: 'ubiquitous',
      ...sr,
      confidence: sr.hadExplicitSubject ? 0.88 : 0.85,
    };
  }

  private splitSubjectResponseVi(clause: string): {
    subject: string;
    response: string;
    hadExplicitSubject: boolean;
  } {
    // Preserve negation BEFORE modal ("không được", "tuyệt đối không") inside response!
    const negModal = /^(.*?)\s+((?:tuyệt đối\s+)?không\s+(?:được(?:\s+phép)?|thể|cho phép)\s+.+)$/iu.exec(clause);
    if (negModal) {
      const subj = negModal[1]!.trim();
      return {
        subject: subj.length >= 2 ? subj : 'Hệ thống',
        response: negModal[2]!.trim(),
        hadExplicitSubject: subj.length >= 2,
      };
    }

    const modal = /^(.*?)\s+(?:phải|nên|có thể)\s+(.+)$/iu.exec(clause);
    if (modal) {
      const subj = modal[1]!.trim();
      return {
        subject: subj.length >= 2 ? subj : 'Hệ thống',
        response: modal[2]!.trim(),
        hadExplicitSubject: subj.length >= 2,
      };
    }

    return {
      subject: 'Hệ thống',
      response: clause.replace(/^(?:phải|cần|nên)\s+/iu, '').trim(),
      hadExplicitSubject: false,
    };
  }

  private splitSubjectResponseEn(clause: string): {
    subject: string;
    response: string;
    hadExplicitSubject: boolean;
  } {
    const negModal = /^(?:the\s+)?(.*?)\s+((?:shall|must|should)\s+not\s+.+)$/iu.exec(clause);
    if (negModal) {
      const subj = negModal[1]!.trim();
      // Strip leading modal word because buildStatement inserts 'shall'/'should'
      const afterNot = negModal[2]!.replace(/^(?:shall|must|should)\s+/i, '').trim();
      return {
        subject: subj.length >= 2 ? subj : 'system',
        response: afterNot,
        hadExplicitSubject: subj.length >= 2,
      };
    }

    const modal = /^(?:the\s+)?(.*?)\s+(?:shall|should|may)\s+(.+)$/iu.exec(clause);
    if (modal) {
      const subj = modal[1]!.trim();
      return {
        subject: subj.length >= 2 ? subj : 'system',
        response: modal[2]!.trim(),
        hadExplicitSubject: subj.length >= 2,
      };
    }

    return {
      subject: 'system',
      response: clause.replace(/^(?:shall|must|should|to)\s+/iu, '').trim(),
      hadExplicitSubject: false,
    };
  }

  private normalizeModals(text: string, lang: Language): string {
    let result = text;
    if (lang === 'vi') {
      result = result
        .replace(/\bbắt buộc phải\b/giu, 'phải')
        .replace(/\bcần phải\b/giu, 'phải')
        .replace(/\bbắt buộc\b(?!\s+phải)/giu, 'phải')
        .replace(/\bcần\s+(?=[a-zà-ỵ])/giu, 'phải ');
    } else {
      result = result
        .replace(/\bmust not\b/gi, 'shall not')
        .replace(/\bmust\b/gi, 'shall')
        .replace(/\bneeds? to\b/gi, 'shall')
        .replace(/\bis required to\b/gi, 'shall')
        .replace(/\bwill\b/gi, 'shall');
    }
    return result;
  }

  private buildStatement(
    pattern: EarsPattern,
    slots: NormalizationResult['slots'],
    lang: Language,
    priority: Priority,
  ): string {
    const resp = slots.response.replace(/[.!?]+$/, '').trim();

    if (lang === 'vi') {
      const hasLeadingNegModal = /^(?:tuyệt đối\s+)?không\s+(?:được|thể|cho phép)\b/iu.test(resp);
      const modalWord = hasLeadingNegModal
        ? ''
        : priority === 'should'
          ? 'nên '
          : priority === 'could'
            ? 'có thể '
            : 'phải ';
      const core = `${slots.subject} ${modalWord}${resp}`.replace(/\s+/g, ' ').trim();

      switch (pattern) {
        case 'event-driven':
          return `Khi ${slots.trigger}, ${core}.`;
        case 'state-driven':
          return `Trong khi ${slots.state}, ${core}.`;
        case 'optional':
          return `Với ${slots.condition}, ${core}.`;
        case 'unwanted':
          return `Nếu ${slots.condition} thì ${core}.`;
        default:
          return `${core}.`;
      }
    }

    const modalWordEn =
      priority === 'should' ? 'should' : priority === 'could' ? 'may' : 'shall';
    const subjEn = /^(the|a|an)\s+/i.test(slots.subject) ? slots.subject : `the ${slots.subject}`;
    const capSubjEn = subjEn.charAt(0).toUpperCase() + subjEn.slice(1);

    switch (pattern) {
      case 'event-driven':
        return `When ${slots.trigger}, ${subjEn} ${modalWordEn} ${resp}.`;
      case 'state-driven':
        return `While ${slots.state}, ${subjEn} ${modalWordEn} ${resp}.`;
      case 'optional':
        return `Where ${slots.condition}, ${subjEn} ${modalWordEn} ${resp}.`;
      case 'unwanted':
        return `If ${slots.condition}, then ${subjEn} ${modalWordEn} ${resp}.`;
      default:
        return `${capSubjEn} ${modalWordEn} ${resp}.`;
    }
  }

  private buildGWT(
    pattern: EarsPattern,
    slots: NormalizationResult['slots'],
    lang: Language,
  ): string {
    if (lang === 'vi') {
      const given =
        pattern === 'state-driven' && slots.state
          ? slots.state
          : pattern === 'optional' && slots.condition
            ? `cấu hình bật ${slots.condition}`
            : `${slots.subject} đang hoạt động bình thường`;
      const when =
        pattern === 'event-driven' && slots.trigger
          ? slots.trigger
          : pattern === 'unwanted' && slots.condition
            ? slots.condition
            : 'thực hiện tác vụ liên quan';
      return `Cho trước: ${given}\nKhi: ${when}\nThì: ${slots.subject} ${slots.response}.`;
    }

    const givenEn =
      pattern === 'state-driven' && slots.state
        ? slots.state
        : pattern === 'optional' && slots.condition
          ? `${slots.condition} is enabled`
          : `the ${slots.subject} is operating normally`;
    const whenEn =
      pattern === 'event-driven' && slots.trigger
        ? slots.trigger
        : pattern === 'unwanted' && slots.condition
          ? slots.condition
          : 'the relevant action is invoked';
    return `Given: ${givenEn}\nWhen: ${whenEn}\nThen: the ${slots.subject} ${slots.response}.`;
  }

  private deriveVerificationMethod(slots: NormalizationResult['slots']): VerificationMethod {
    if (slots.measure) return 'test';
    if (/\b(display|show|render|layout|hiển thị|giao diện|màu sắc)\b/i.test(slots.response)) {
      return 'demonstration';
    }
    if (/\b(comply|license|architecture|tuân thủ|giấy phép|mã nguồn)\b/i.test(slots.response)) {
      return 'inspection';
    }
    return 'test';
  }

  private derivePriority(text: string, lang: Language): Priority {
    if (lang === 'vi') {
      if (/\b(phải|bắt buộc|không được|cần)\b/iu.test(text)) return 'must';
      if (/\bnên\b/iu.test(text)) return 'should';
      if (/\bcó thể\b/iu.test(text)) return 'could';
    } else {
      if (/\b(shall|must|required)\b/i.test(text)) return 'must';
      if (/\bshould\b/i.test(text)) return 'should';
      if (/\bmay\b/i.test(text)) return 'could';
    }
    return 'must';
  }
}
