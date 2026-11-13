/**
 * S7: Merge and Reduce
 *
 * Finds and merges duplicate/near-duplicate requirements while enforcing
 * deterministic safety blockers (FR-REQ-009):
 * - Different numeric values or units -> NEVER auto-merge
 * - Different negation polarity -> NEVER auto-merge
 * - NEVER silently deletes: merged requirements keep union of source segment IDs.
 */

import type { LocalModelPort } from '../decision/local-model.port.js';

export interface MergeCandidate {
  id1: string;
  id2: string;
  similarity: number;
  tier: 0 | 1 | 2;
  recommendation: 'merge' | 'review' | 'keep_separate';
  reason: string;
}

const QUANT_TOKEN_RE =
  /(\d+(?:[.,]\d+)?)\s*(ms|mili giây|milliseconds?|giây|seconds?|s|phút|minutes?|giờ|hours?|%|mb|gb|kb|rpm|rps|tps|req\/s|users?|người dùng|devices?|thiết bị)?/giu;

const NEGATION_EN = /\b(not|no|never|without|except|unless|cannot|prohibited|forbid)\b/i;
const NEGATION_VI = /\b(không|chưa|chẳng|cấm|ngoại trừ|trừ khi|tuyệt đối không)\b/iu;

const BOILERPLATE_STOPWORDS = new Set([
  'the', 'system', 'shall', 'must', 'should', 'will', 'allow', 'able', 'when', 'while', 'then',
  'hệ', 'thống', 'phải', 'cần', 'nên', 'cho', 'phép', 'được', 'khi', 'trong', 'của', 'các', 'một',
]);

function normalizeQuantity(rawNum: string, rawUnit?: string): string {
  const n = parseFloat(rawNum.replace(',', '.'));
  const u = (rawUnit ?? '').trim().toLowerCase();
  if (['s', 'second', 'seconds', 'giây'].includes(u)) return `${n * 1000}ms`;
  if (['ms', 'millisecond', 'milliseconds', 'mili giây'].includes(u)) return `${n}ms`;
  if (['minute', 'minutes', 'phút'].includes(u)) return `${n * 60000}ms`;
  if (['hour', 'hours', 'giờ'].includes(u)) return `${n * 3600000}ms`;
  if (['user', 'users', 'người dùng'].includes(u)) return `${n}users`;
  if (['device', 'devices', 'thiết bị'].includes(u)) return `${n}devices`;
  return `${n}${u}`;
}

export function extractNormalizedQuantities(text: string): string[] {
  const out: string[] = [];
  QUANT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUANT_TOKEN_RE.exec(text)) !== null) {
    out.push(normalizeQuantity(m[1]!, m[2]));
  }
  return out.sort();
}

export class S7MergeAndReduce {
  /**
   * Deterministic hard-blocker check shared across Tier 0, Tier 1, and Tier 2.
   */
  hasHardBlocker(
    req1: { text: string; language: 'vi' | 'en'; type?: string },
    req2: { text: string; language: 'vi' | 'en'; type?: string },
  ): string | null {
    const nums1 = extractNormalizedQuantities(req1.text);
    const nums2 = extractNormalizedQuantities(req2.text);
    if (nums1.length > 0 || nums2.length > 0) {
      const same = nums1.length === nums2.length && nums1.every((n, idx) => n === nums2[idx]);
      if (!same) {
        return `Different numeric constraints (${nums1.join(', ') || 'none'} vs ${nums2.join(', ') || 'none'})`;
      }
    }

    const hasNeg1 = NEGATION_VI.test(req1.text) || NEGATION_EN.test(req1.text);
    const hasNeg2 = NEGATION_VI.test(req2.text) || NEGATION_EN.test(req2.text);
    if (hasNeg1 !== hasNeg2) {
      return 'Opposite negation polarity — contradictory rather than duplicate';
    }

    if (req1.type && req2.type && req1.type !== req2.type) {
      const incompatible =
        (req1.type === 'functional' && req2.type === 'non-functional') ||
        (req1.type === 'non-functional' && req2.type === 'functional');
      if (incompatible) {
        return `Incompatible requirement types (${req1.type} vs ${req2.type})`;
      }
    }

    return null;
  }

  /**
   * Tier 0: Lexical Jaccard similarity on content tokens after checking deterministic blockers.
   */
  tier0(
    req1: { id: string; text: string; language: 'vi' | 'en'; type?: string },
    req2: { id: string; text: string; language: 'vi' | 'en'; type?: string },
  ): MergeCandidate {
    const blockReason = this.hasHardBlocker(req1, req2);
    if (blockReason) {
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: 0,
        tier: 0,
        recommendation: 'keep_separate',
        reason: blockReason,
      };
    }

    const words1 = new Set(this.tokenize(req1.text));
    const words2 = new Set(this.tokenize(req2.text));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    if (jaccard >= 0.88) {
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: jaccard,
        tier: 0,
        recommendation: 'merge',
        reason: `High lexical similarity (Jaccard=${jaccard.toFixed(2)})`,
      };
    }
    if (jaccard >= 0.72) {
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: jaccard,
        tier: 0,
        recommendation: 'review',
        reason: `Moderate lexical similarity (Jaccard=${jaccard.toFixed(2)}) — review recommended`,
      };
    }
    return {
      id1: req1.id,
      id2: req2.id,
      similarity: jaccard,
      tier: 0,
      recommendation: 'keep_separate',
      reason: `Low lexical similarity (Jaccard=${jaccard.toFixed(2)})`,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !BOILERPLATE_STOPWORDS.has(w));
  }

  /** Tier 1: Cosine similarity on multilingual embeddings + NLI check via LocalModelPort. */
  async tier1(
    req1: { id: string; text: string; language: 'vi' | 'en'; embedding?: number[] },
    req2: { id: string; text: string; language: 'vi' | 'en'; embedding?: number[] },
    localModel?: LocalModelPort,
  ): Promise<MergeCandidate | null> {
    if (!localModel) return null;
    const blockReason = this.hasHardBlocker(req1, req2);
    if (blockReason) {
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: 0,
        tier: 1,
        recommendation: 'keep_separate',
        reason: blockReason,
      };
    }

    let emb1 = req1.embedding;
    let emb2 = req2.embedding;
    if (!emb1 || !emb2) {
      const computed = await localModel.embed([req1.text, req2.text]);
      emb1 = computed[0];
      emb2 = computed[1];
    }
    if (!emb1 || !emb2 || emb1.length !== emb2.length) return null;

    let dot = 0;
    let n1 = 0;
    let n2 = 0;
    for (let i = 0; i < emb1.length; i++) {
      dot += emb1[i]! * emb2[i]!;
      n1 += emb1[i]! * emb1[i]!;
      n2 += emb2[i]! * emb2[i]!;
    }
    const cosine = n1 > 0 && n2 > 0 ? dot / (Math.sqrt(n1) * Math.sqrt(n2)) : 0;

    if (cosine >= 0.92) {
      const nli = await localModel.nli(req1.text, req2.text);
      if (nli.label === 'contradiction') {
        return {
          id1: req1.id,
          id2: req2.id,
          similarity: cosine,
          tier: 1,
          recommendation: 'keep_separate',
          reason: 'NLI detected semantic contradiction',
        };
      }
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: cosine,
        tier: 1,
        recommendation: 'merge',
        reason: `Semantic similarity=${cosine.toFixed(2)} (${nli.label})`,
      };
    }
    if (cosine >= 0.8) {
      return {
        id1: req1.id,
        id2: req2.id,
        similarity: cosine,
        tier: 1,
        recommendation: 'review',
        reason: `Semantic similarity=${cosine.toFixed(2)} in review band`,
      };
    }
    return null;
  }
}
