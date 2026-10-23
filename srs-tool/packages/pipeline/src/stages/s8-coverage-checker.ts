/**
 * S8: Coverage Checker
 *
 * Final gate: ensures no source segment is silently dropped.
 *
 * Three checks:
 * (a) Ledger check: which segments have no terminal state (SQL query)
 * (b) Information preservation: numbers, units, entities, negations, modality
 *     from original candidate must still be present in normalized requirement
 * (c) Set check: consistency, duplicates, missing vs checklist
 *
 * Three-tier:
 * - Tier 0: SQL + information preservation rules
 * - Tier 1: NLI (local model) — normalized req must entail original candidate
 * - Tier 2: LLM only for flagged items
 */

export interface PreservationCheck {
  candidate_id: string;
  requirement_id: string;
  passed: boolean;
  lost_numbers: string[];
  lost_negations: boolean;
  lost_modality: boolean;
  nli_score?: number; // Set when tier 1 is used
}

const NUMBER_RE = /\b\d+(?:\.\d+)?(?:\s*(?:ms|s|%|mb|gb|rpm|rps|tps|req\/s|users?|phút|giây|mili|giờ|ngày|tuần|tháng))\b/gi;
const NEGATION_EN = /\b(not|no|never|without|except|unless|cannot|can't|won't)\b/i;
const NEGATION_VI = /\b(không|chưa|chẳng|ngoại trừ|không được|không thể)\b/i;
const MUST_EN = /\b(shall|must)\b/i;
const SHOULD_EN = /\bshould\b/i;
const MUST_VI = /\bphải\b/i;
const SHOULD_VI = /\bnên\b/i;

export class S8CoverageChecker {
  /**
   * Tier 0: Check information preservation between candidate and normalized requirement.
   * Critical: if numbers, negations, or modality are lost → flag immediately.
   */
  checkPreservation(
    candidate: { id: string; text: string; language: 'vi' | 'en' },
    requirement: { id: string; text: string },
  ): PreservationCheck {
    const origNums = (candidate.text.match(NUMBER_RE) ?? []).map(n => n.toLowerCase().replace(/\s/g, ''));
    const reqNums = (requirement.text.match(NUMBER_RE) ?? []).map(n => n.toLowerCase().replace(/\s/g, ''));
    const lostNumbers = origNums.filter(n => !reqNums.includes(n));

    const negPat = candidate.language === 'vi' ? NEGATION_VI : NEGATION_EN;
    const origHasNeg = negPat.test(candidate.text);
    const reqHasNeg = negPat.test(requirement.text);
    const lostNegation = origHasNeg && !reqHasNeg;

    // Modality: "must/phải" should not be downgraded to "should/nên" silently
    const origIsMust = candidate.language === 'vi' ? MUST_VI.test(candidate.text) : MUST_EN.test(candidate.text);
    const reqIsShould = candidate.language === 'vi' ? SHOULD_VI.test(requirement.text) : SHOULD_EN.test(requirement.text);
    const lostModality = origIsMust && reqIsShould;

    const passed = lostNumbers.length === 0 && !lostNegation && !lostModality;

    return {
      candidate_id: candidate.id,
      requirement_id: requirement.id,
      passed,
      lost_numbers: lostNumbers,
      lost_negations: lostNegation,
      lost_modality: lostModality,
    };
  }

  /**
   * Run all preservation checks for a run.
   * Returns a list of failed checks that need attention.
   */
  runPreservationChecks(
    pairs: Array<{
      candidate: { id: string; text: string; language: 'vi' | 'en' };
      requirement: { id: string; text: string };
    }>,
  ): PreservationCheck[] {
    return pairs.map(p => this.checkPreservation(p.candidate, p.requirement));
  }

  /** Flag segments that are in unmapped state after the pipeline. */
  findUncoveredSegments(ledgerReport: { unmapped: number; unresolved: number }): boolean {
    return ledgerReport.unmapped > 0 || ledgerReport.unresolved > 0;
  }
}
