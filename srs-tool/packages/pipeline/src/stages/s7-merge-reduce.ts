/**
 * S7: Merge and Reduce
 *
 * Finds and merges duplicate/near-duplicate requirements.
 * Supports cross-language deduplication (Vi-En pairs).
 * NEVER silently deletes — merged requirements keep union of source IDs.
 *
 * Three-tier:
 * - Tier 0: Lexical signature (Jaccard/MinHash) for near-verbatim duplicates.
 *           Blocking conditions: different numbers, units, subjects, or negation → NO auto-merge.
 * - Tier 1: Multilingual embeddings (pgvector) for semantic similarity.
 *           Two thresholds: auto-merge (≥0.92), review band (0.80–0.92), skip (<0.80).
 *           NLI for pairs in review band.
 * - Tier 2: Small LLM for pairs in review band with low NLI confidence.
 */

export interface MergeCandidate {
  id1: string;
  id2: string;
  similarity: number;
  tier: 0 | 1 | 2;
  recommendation: 'merge' | 'review' | 'keep_separate';
  reason: string;
}

// Blocking conditions

const NUMBER_RE = /\b\d+(?:\.\d+)?(?:\s*(?:ms|s|%|mb|gb|rpm|rps|tps|req\/s|users?))\b/gi;
const NEGATION_EN = /\b(not|no|never|without|except|unless)\b/i;
const NEGATION_VI = /\b(không|chưa|chẳng|ngoại trừ|trừ khi)\b/i;

export class S7MergeAndReduce {
  /**
   * Tier 0: Lexical similarity using Jaccard on normalized word sets.
   * Returns recommendation without calling any model.
   */
  tier0(
    req1: { id: string; text: string; language: 'vi' | 'en' },
    req2: { id: string; text: string; language: 'vi' | 'en' },
  ): MergeCandidate {
    // Extract blocking features
    const nums1 = (req1.text.match(NUMBER_RE) ?? []).map(n => n.toLowerCase().replace(/\s/g, ''));
    const nums2 = (req2.text.match(NUMBER_RE) ?? []).map(n => n.toLowerCase().replace(/\s/g, ''));
    const hasNeg1 = (req1.language === 'vi' ? NEGATION_VI : NEGATION_EN).test(req1.text);
    const hasNeg2 = (req2.language === 'vi' ? NEGATION_VI : NEGATION_EN).test(req2.text);

    // Blocking condition: different numbers → NEVER auto-merge
    if (nums1.length > 0 || nums2.length > 0) {
      const same = nums1.length === nums2.length && nums1.every((n, i) => n === nums2[i]);
      if (!same) {
        return {
          id1: req1.id, id2: req2.id,
          similarity: 0,
          tier: 0,
          recommendation: 'keep_separate',
          reason: 'Different numeric values — requirements have different constraints',
        };
      }
    }

    // Blocking condition: one negated, one not
    if (hasNeg1 !== hasNeg2) {
      return {
        id1: req1.id, id2: req2.id,
        similarity: 0,
        tier: 0,
        recommendation: 'keep_separate',
        reason: 'One requirement is negated — likely contradictory, not duplicate',
      };
    }

    // Lexical Jaccard similarity
    const words1 = new Set(this.tokenize(req1.text));
    const words2 = new Set(this.tokenize(req2.text));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    if (jaccard >= 0.92) {
      return { id1: req1.id, id2: req2.id, similarity: jaccard, tier: 0, recommendation: 'merge', reason: `High lexical similarity (Jaccard=${jaccard.toFixed(2)})` };
    }
    if (jaccard >= 0.80) {
      return { id1: req1.id, id2: req2.id, similarity: jaccard, tier: 0, recommendation: 'review', reason: `Moderate lexical similarity (Jaccard=${jaccard.toFixed(2)}) — needs semantic check` };
    }
    return { id1: req1.id, id2: req2.id, similarity: jaccard, tier: 0, recommendation: 'keep_separate', reason: `Low lexical similarity (Jaccard=${jaccard.toFixed(2)})` };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /** Tier 1 and 2: To be implemented when embedding model is available */
  async tier1(_req1: { id: string; embedding: number[] }, _req2: { id: string; embedding: number[] }): Promise<MergeCandidate | null> {
    // TODO: Cosine similarity on multilingual embeddings
    // TODO: NLI for pairs in review band
    return null;
  }
}
