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
import { splitSentences, wordsRegex } from '../text.js';

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

/** Verdict of S2 for a whole segment. */
export type SegmentVerdict = 'has_candidates' | 'not_requirement' | 'unclear';

// Modal verb patterns (Unicode-aware; see ../text.ts)

const MODAL_PATTERNS_EN = [
  wordsRegex(['shall', 'must', 'should', 'will', 'needs to', 'need to', 'is required to', 'are required to', 'is expected to', 'must not', 'shall not']),
];

const MODAL_PATTERNS_VI = [
  wordsRegex(['phải', 'cần', 'nên', 'có thể', 'không được', 'bắt buộc', 'yêu cầu', 'cho phép', 'hỗ trợ', 'đảm bảo']),
];

/** 'may' / 'có thể' are weak signals: lower confidence than shall/phải */
const WEAK_MODAL_EN = wordsRegex(['may', 'can', 'could']);

const USER_STORY_EN = /^as\s+an?\s+.+?,?\s+i\s+(want|need|would like)\s+/i;
const USER_STORY_VI = /^(là|với tư cách là)\s+.+?,?\s+(tôi muốn|tôi cần|tôi mong muốn)\s+/iu;
const REQ_CODE = /(?<![\p{L}\p{N}])(FR|NFR|UC|REQ|SRS|CON|IF)-[\w-]+/iu;
const QUESTION = /\?\s*$/;

/** Hints that a segment *may* contain an implicit requirement even without modal verbs. */
const HINT_PATTERNS = [
  /\d+\s*(ms|s|giây|phút|%|mb|gb|rps|tps|users?|người dùng)/i,
  wordsRegex(['system', 'hệ thống', 'application', 'ứng dụng', 'user', 'người dùng', 'admin', 'quản trị', 'support', 'provide', 'cung cấp']),
];

export class S2ExtractCandidates {
  /**
   * Tier 0: Rule-based extraction.
   * Returns candidates with confidence based on pattern strength.
   */
  tier0(input: S2Input): RequirementCandidate[] {
    const modals = input.language === 'vi' ? MODAL_PATTERNS_VI : MODAL_PATTERNS_EN;
    const storyPat = input.language === 'vi' ? USER_STORY_VI : USER_STORY_EN;
    const sentences = splitSentences(input.text, input.language);
    const candidates: RequirementCandidate[] = [];

    for (const sentence of sentences) {
      if (QUESTION.test(sentence)) continue; // questions are clarification, not requirements

      let confidence = 0;

      // Strong signals: modal verbs
      if (modals.some((p) => p.test(sentence))) confidence = Math.max(confidence, 0.85);

      // Weak modal in English ("may", "can") — below default accept threshold
      if (input.language === 'en' && WEAK_MODAL_EN.test(sentence)) confidence = Math.max(confidence, 0.6);

      // Very strong: requirement code
      if (REQ_CODE.test(sentence)) confidence = Math.max(confidence, 0.95);

      // User story
      if (storyPat.test(sentence)) confidence = Math.max(confidence, 0.9);

      // Modal + measurable value is a stronger signal
      if (confidence >= 0.85 && /\d+\s*(ms|s|giây|phút|%|mb|gb|rps|tps)/i.test(sentence)) {
        confidence = Math.min(0.98, confidence + 0.05);
      }

      if (confidence > 0) {
        candidates.push({
          id: crypto.randomUUID(),
          segment_id: input.segment_id,
          text: sentence,
          text_original: sentence,
          language: input.language,
          confidence,
          tier: 0,
        });
      }
    }

    return candidates;
  }

  /**
   * Decide what to do with a segment given the candidates found for it.
   * - has_candidates: at least one candidate with confidence ≥ minConfidence
   * - unclear: no confident candidate but the text looks like it could hold a requirement
   *            (must NOT be silently dropped → escalate / needs review)
   * - not_requirement: heading-like, question, or no requirement hints at all
   */
  verdict(input: S2Input, candidates: RequirementCandidate[], minConfidence = 0.8): SegmentVerdict {
    if (candidates.some((c) => c.confidence >= minConfidence)) return 'has_candidates';
    if (candidates.length > 0) return 'unclear';
    if (QUESTION.test(input.text.trim())) return 'not_requirement';
    if (HINT_PATTERNS.some((p) => p.test(input.text))) return 'unclear';
    return 'not_requirement';
  }

  // tier1 and tier2 will be implemented when local models are available
}
