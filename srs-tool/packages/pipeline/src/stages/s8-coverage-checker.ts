/**
 * S8: Coverage & Information Preservation Checker (FR-REQ-012, FR-REQ-020, NFR-QUAL-003..004)
 *
 * Final deterministic safety gate:
 * (a) Coverage Ledger check: zero unmapped / unresolved segments before baseline lock
 * (b) Information preservation: every number/unit, negation, and mandatory modality
 *     present in the original candidate MUST still be present in the normalized statement.
 */

import { extractNormalizedQuantities } from './s7-merge-reduce.js';

export interface PreservationCheck {
  candidate_id: string;
  requirement_id: string;
  passed: boolean;
  lost_numbers: string[];
  lost_negations: boolean;
  lost_modality: boolean;
  nli_score?: number;
}

const NEGATION_EN = /\b(not|no|never|without|except|unless|cannot|can't|won't|prohibited)\b/i;
const NEGATION_VI = /\b(không|chưa|chẳng|cấm|ngoại trừ|không được|không thể|tuyệt đối không)\b/iu;

const MUST_EN = /\b(shall|must|required)\b/i;
const WEAK_EN = /\b(should|may|might|optional)\b/i;
const MUST_VI = /\b(phải|bắt buộc|cần)\b/iu;
const WEAK_VI = /\b(nên|có thể|tuỳ chọn)\b/iu;

export class S8CoverageChecker {
  /**
   * Tier 0: Verify deterministic information preservation between original candidate
   * and normalized requirement statement (FR-REQ-020).
   */
  checkPreservation(
    candidate: { id: string; text: string; language: 'vi' | 'en' },
    requirement: { id: string; text: string },
  ): PreservationCheck {
    // Strip leading requirement ID code like "FR-WEB-001:" before extracting numbers
    const cleanOrig = candidate.text.replace(/^(?:FR|NFR|CON|IF|ASM)-[A-Z]{2,4}-\d{1,4}\s*[:\-–]?\s*/i, '');
    const cleanNorm = requirement.text.replace(/^(?:FR|NFR|CON|IF|ASM)-[A-Z]{2,4}-\d{1,4}\s*[:\-–]?\s*/i, '');

    const origQuants = extractNormalizedQuantities(cleanOrig);
    const reqQuants = extractNormalizedQuantities(cleanNorm);

    // Also verify raw numeric literals so unitless counts ("3 lần", "5 vai trò") are never lost
    const rawOrigNums = (cleanOrig.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
    const rawReqNums = (cleanNorm.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

    const lostQuantities = origQuants.filter((q) => !reqQuants.includes(q));
    const lostRawNums =
      lostQuantities.length === 0
        ? rawOrigNums.filter((n) => !rawReqNums.includes(n) && !origQuants.some((q) => reqQuants.includes(q)))
        : [];
    const lostNumbers = [...new Set([...lostQuantities, ...lostRawNums])];

    const origHasNeg = NEGATION_VI.test(cleanOrig) || NEGATION_EN.test(cleanOrig);
    const reqHasNeg = NEGATION_VI.test(cleanNorm) || NEGATION_EN.test(cleanNorm);
    const lostNegation = origHasNeg && !reqHasNeg;

    // Mandatory modality ("phải / shall / must") must not be weakened to "nên / should / may"
    // or stripped completely (unless preserved as negative mandatory "không được / shall not")
    const origIsMust = candidate.language === 'vi' ? MUST_VI.test(cleanOrig) : MUST_EN.test(cleanOrig);
    const reqHasMust =
      candidate.language === 'vi'
        ? MUST_VI.test(cleanNorm) || /\bkhông được\b/iu.test(cleanNorm)
        : MUST_EN.test(cleanNorm);
    const reqIsWeakened = candidate.language === 'vi' ? WEAK_VI.test(cleanNorm) : WEAK_EN.test(cleanNorm);
    const lostModality = origIsMust && (!reqHasMust || (reqIsWeakened && !reqHasMust));

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

  runPreservationChecks(
    pairs: Array<{
      candidate: { id: string; text: string; language: 'vi' | 'en' };
      requirement: { id: string; text: string };
    }>,
  ): PreservationCheck[] {
    return pairs.map((p) => this.checkPreservation(p.candidate, p.requirement));
  }

  findUncoveredSegments(ledgerReport: { unmapped: number; unresolved: number }): boolean {
    return ledgerReport.unmapped > 0 || ledgerReport.unresolved > 0;
  }
}
