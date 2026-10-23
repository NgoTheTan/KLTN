/**
 * S6: Normalizer (EARS pattern normalization)
 *
 * Converts requirement candidates into standardized EARS format.
 * Steps:
 * 1. Identify EARS pattern type from leading keywords
 * 2. Fill slots (trigger/state/condition, subject, response, measure)
 * 3. Safe lint-based fixes (modal verb normalization)
 * 4. Self-check: lint + information preservation
 * 5. Generate Given/When/Then acceptance criteria
 * 6. Generate verification method
 *
 * Three-tier:
 * - Tier 0: Slot-fill from EARS patterns, safe fixes, lint
 * - Tier 2: Small LLM for free-form text that can't be slot-filled; large LLM if lint fails
 *
 * NOTE: Tier 1 (local model) skipped for normalization; it's a generation task.
 */

import type { EarsPattern, Language, Priority, VerificationMethod } from '@srs-tool/schemas';

export interface NormalizationResult {
  statement: string;
  ears_pattern: EarsPattern;
  priority: Priority;
  acceptance_criteria: string; // Given/When/Then
  verification_method: VerificationMethod;
  slots: {
    trigger?: string;
    state?: string;
    condition?: string;
    subject: string;
    response: string;
    measure?: string;
  };
  lint_passed: boolean;
  info_preserved: boolean;
  tier: 0 | 2;
}

// EARS pattern keyword detection

const EARS_TRIGGERS: Record<EarsPattern, { vi: RegExp; en: RegExp }> = {
  'event-driven': {
    en: /^when\s+/i,
    vi: /^khi\s+/i,
  },
  'state-driven': {
    en: /^while\s+/i,
    vi: /^trong khi\s+/i,
  },
  optional: {
    en: /^where\s+/i,
    vi: /^với\s+/i,
  },
  unwanted: {
    en: /^if\s+.+,?\s*then\s+/i,
    vi: /^nếu\s+.+,?\s*thì\s+/i,
  },
  ubiquitous: {
    en: /^the\s+\w+\s+shall\s+/i,
    vi: /^\w+\s+phải\s+/i,
  },
  complex: {
    en: /^(when|while|where|if).+(when|while|where|if)/i,
    vi: /^(khi|trong khi|nếu|với).+(khi|trong khi|nếu|với)/i,
  },
};

// Modal verb normalization
const MODAL_NORMALIZE_EN: Array<[RegExp, string]> = [
  [/\bmust\b/g, 'shall'],
  [/\bneed(s?) to\b/g, 'shall'],
  [/\bis required to\b/g, 'shall'],
  [/\bwill\b/g, 'shall'],
];

const MODAL_NORMALIZE_VI: Array<[RegExp, string]> = [
  [/\bcần phải\b/g, 'phải'],
  [/\bbắt buộc phải\b/g, 'phải'],
  [/\byêu cầu\b.*\bphải\b/g, 'phải'],
];

export class S6Normalizer {
  /**
   * Tier 0: Identify EARS pattern and attempt slot-filling.
   */
  tier0(text: string, language: Language): NormalizationResult | null {
    const pattern = this.detectPattern(text, language);
    if (!pattern) return null;

    // Apply safe modal verb normalization
    const normalized = this.normalizeModals(text, language);

    // Extract slots (simplified - full implementation uses NLP)
    const slots = this.extractSlots(normalized, pattern, language);
    if (!slots.subject || !slots.response) return null;

    // Build EARS statement
    const statement = this.buildStatement(pattern, slots, language);

    // Generate Given/When/Then
    const acceptance_criteria = this.buildGWT(slots, language);

    // Determine verification method
    const verification_method = this.deriveVerificationMethod(slots);

    // Determine priority from modal verb
    const priority = this.derivePriority(text, language);

    return {
      statement,
      ears_pattern: pattern,
      priority,
      acceptance_criteria,
      verification_method,
      slots,
      lint_passed: true, // Will be re-checked by S4 after normalization
      info_preserved: true, // Will be verified by S8
      tier: 0,
    };
  }

  private detectPattern(text: string, lang: Language): EarsPattern | null {
    for (const [pattern, triggers] of Object.entries(EARS_TRIGGERS)) {
      const re = lang === 'vi' ? triggers.vi : triggers.en;
      if (re.test(text.trim())) return pattern as EarsPattern;
    }
    return null;
  }

  private normalizeModals(text: string, lang: Language): string {
    let result = text;
    const rules = lang === 'vi' ? MODAL_NORMALIZE_VI : MODAL_NORMALIZE_EN;
    for (const [pattern, replacement] of rules) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  private extractSlots(
    text: string,
    _pattern: EarsPattern,
    _lang: Language,
  ): NormalizationResult['slots'] {
    // TODO: Implement full slot extraction using Intl.Segmenter + keyword anchors
    // Simplified: use "shall/phải" as anchor point
    const shallMatch = text.match(/^(.*?)\s+(?:shall|phải)\s+(.+)$/i);
    if (shallMatch) {
      return {
        subject: shallMatch[1]?.trim() ?? '',
        response: shallMatch[2]?.trim() ?? '',
      };
    }
    return { subject: '', response: text };
  }

  private buildStatement(
    pattern: EarsPattern,
    slots: NormalizationResult['slots'],
    lang: Language,
  ): string {
    if (lang === 'vi') {
      switch (pattern) {
        case 'event-driven': return `Khi ${slots.trigger ?? '?'}, ${slots.subject} phải ${slots.response}${slots.measure ? ' trong ' + slots.measure : ''}.`;
        case 'state-driven': return `Trong khi ${slots.state ?? '?'}, ${slots.subject} phải ${slots.response}.`;
        case 'unwanted': return `Nếu ${slots.condition ?? '?'} thì ${slots.subject} phải ${slots.response}${slots.measure ? ' trong ' + slots.measure : ''}.`;
        default: return `${slots.subject} phải ${slots.response}.`;
      }
    } else {
      switch (pattern) {
        case 'event-driven': return `When ${slots.trigger ?? '?'}, the ${slots.subject} shall ${slots.response}${slots.measure ? ' within ' + slots.measure : ''}.`;
        case 'state-driven': return `While ${slots.state ?? '?'}, the ${slots.subject} shall ${slots.response}.`;
        case 'unwanted': return `If ${slots.condition ?? '?'}, then the ${slots.subject} shall ${slots.response}${slots.measure ? ' within ' + slots.measure : ''}.`;
        default: return `The ${slots.subject} shall ${slots.response}.`;
      }
    }
  }

  private buildGWT(slots: NormalizationResult['slots'], lang: Language): string {
    if (lang === 'vi') {
      return `Cho trước: ${slots.state ?? slots.trigger ?? 'điều kiện ban đầu'}\nKhi: ${slots.trigger ?? 'sự kiện xảy ra'}\nThì: ${slots.subject} ${slots.response}${slots.measure ? ' trong ' + slots.measure : ''}.`;
    }
    return `Given: ${slots.state ?? slots.trigger ?? 'initial state'}\nWhen: ${slots.trigger ?? 'event occurs'}\nThen: the ${slots.subject} ${slots.response}${slots.measure ? ' within ' + slots.measure : ''}.`;
  }

  private deriveVerificationMethod(slots: NormalizationResult['slots']): VerificationMethod {
    if (slots.measure) return 'test'; // Quantified → testable
    if (slots.response?.match(/\b(display|show|render|render|hiển thị|hiện)\b/i)) return 'inspection';
    return 'test';
  }

  private derivePriority(text: string, lang: Language): Priority {
    if (lang === 'vi') {
      if (/\bphải\b/.test(text)) return 'must';
      if (/\bnên\b/.test(text)) return 'should';
      if (/\bcó thể\b/.test(text)) return 'could';
    } else {
      if (/\b(shall|must)\b/i.test(text)) return 'must';
      if (/\bshould\b/i.test(text)) return 'should';
      if (/\bmay\b/i.test(text)) return 'could';
    }
    return 'must';
  }
}
