/**
 * S2: Extract Requirement Candidates
 *
 * Responsibilities:
 * - From each segment, extract sentences/ideas that may be requirements
 * - Preserve original text and segment ID
 * - Maintain same language as source segment
 *
 * Three-tier processing:
 * - Tier 0: Modal verb patterns (shall, must, should, phải, cần, không được...),
 *           user story patterns (As a... I want..., Là... tôi muốn...),
 *           requirement code patterns (FR-xxx, NFR-xxx),
 *           table rows in requirements tables,
 *           email: request sentences
 * - Tier 1: Requirement/non-requirement classifier on embeddings
 * - Tier 2: Small LLM, batch-processed, only for remaining unclear segments
 */

import type { Language } from '@srs-tool/schemas';

export interface RequirementCandidate {
  id: string;
  segment_id: string;
  text: string;
  text_original: string;
  language: Language;
  confidence: number;
  tier: 0 | 1 | 2;
}

export interface S2Input {
  segment_id: string;
  text: string;
  language: Language;
}

export interface S2Output {
  candidates: RequirementCandidate[];
}

// Modal verb patterns

const MODAL_PATTERNS_EN = [
  /\b(shall|must|should|may|will|needs? to|is required to|is expected to)\b/i,
];

const MODAL_PATTERNS_VI = [
  /\b(phải|cần|nên|có thể|không được|bắt buộc|yêu cầu)\b/i,
];

const USER_STORY_EN = /^as\s+a\s+.+\s+i\s+want\s+/i;
const USER_STORY_VI = /^(là|với tư cách là)\s+.+,?\s+(tôi muốn|tôi cần)\s+/i;
const REQ_CODE = /\b(FR|NFR|UC|REQ|SRS)-[\w-]+\b/i;

export class S2ExtractCandidates {
  /**
   * Tier 0: Rule-based extraction.
   * Returns candidates with confidence based on pattern strength.
   */
  tier0(input: S2Input): RequirementCandidate[] {
    const patterns = input.language === 'vi' ? MODAL_PATTERNS_VI : MODAL_PATTERNS_EN;
    const sentences = this.splitSentences(input.text, input.language);
    const candidates: RequirementCandidate[] = [];

    for (const sentence of sentences) {
      let confidence = 0;
      let matched = false;

      // Strong signals: modal verbs
      for (const p of patterns) {
        if (p.test(sentence)) {
          confidence = Math.max(confidence, 0.85);
          matched = true;
        }
      }

      // Very strong: requirement code
      if (REQ_CODE.test(sentence)) {
        confidence = Math.max(confidence, 0.95);
        matched = true;
      }

      // User story
      const storyPat = input.language === 'vi' ? USER_STORY_VI : USER_STORY_EN;
      if (storyPat.test(sentence)) {
        confidence = Math.max(confidence, 0.90);
        matched = true;
      }

      if (matched) {
        candidates.push({
          id: crypto.randomUUID(),
          segment_id: input.segment_id,
          text: sentence.trim(),
          text_original: sentence.trim(),
          language: input.language,
          confidence,
          tier: 0,
        });
      }
    }

    return candidates;
  }

  // tier1 and tier2 will be implemented when local models are available

  private splitSentences(text: string, language: Language): string[] {
    // TODO: Use Intl.Segmenter when available, fallback to punctuation split
    return text
      .split(/(?<=[.!?。])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);
  }
}
