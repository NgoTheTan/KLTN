/**
 * Stage helpers S5→S8.
 *
 * Pure (DB-free) orchestration helpers symmetrical to `stages-1-4.ts`.
 * Every decision in S6, S7, and S8 flows through `DecisionRouter` so `decision_log`
 * captures exact tier, confidence, and rule/model version (NFR-LLM-003).
 */

import type { CoverageReport, Language, Segment } from '@srs-tool/schemas';
import type { Decider, Decision } from './decision/router.js';
import type { StageContext, SegmentDecisionStatus } from './stages-1-4.js';
import { CoverageLedger } from './ledger/coverage.js';
import {
  S5QuestionBuilder,
  type ClarificationQuestion,
  type IssueForQuestion,
} from './stages/s5-question-builder.js';
import { S6Normalizer, type NormalizationResult } from './stages/s6-normalizer.js';
import { S7MergeAndReduce, type MergeCandidate } from './stages/s7-merge-reduce.js';
import { S8CoverageChecker, type PreservationCheck } from './stages/s8-coverage-checker.js';

export const STAGE_5_8_VERSIONS = {
  s5: 'templates-s5@1',
  s6: 'ears-s6@1',
  s7: 'merge-s7@1',
  s8: 'preserve-s8@1',
} as const;

// S5 — Clarification Question Building

export function runQuestionBuilding(
  issues: IssueForQuestion[],
  options: {
    outputLanguage: Language;
    platformDefaults?: Record<string, string | number | boolean>;
  },
): ClarificationQuestion[] {
  const s5 = new S5QuestionBuilder();
  return s5.buildQuestions(issues, options.outputLanguage, options.platformDefaults ?? {});
}

// S6 — EARS Normalization

export interface NormalizationInputItem {
  id: string;
  text: string;
  language: Language;
}

export interface NormalizedRequirementItem {
  id: string;
  normalization: NormalizationResult | null;
  status: SegmentDecisionStatus;
  confidence: number;
}

export async function runNormalization(
  items: NormalizationInputItem[],
  ctx: StageContext,
): Promise<NormalizedRequirementItem[]> {
  const s6 = new S6Normalizer();
  const out: NormalizedRequirementItem[] = [];

  for (const item of items) {
    const decider: Decider<NormalizationInputItem, NormalizationResult> = {
      tier0(inp): Decision<NormalizationResult> | null {
        const res = s6.tier0(inp.text, inp.language);
        if (!res) return null;
        return {
          value: res,
          confidence: res.confidence,
          tier: 0,
          evidence: [res.ears_pattern, res.statement.slice(0, 100)],
          version: STAGE_5_8_VERSIONS.s6,
        };
      },
    };

    const { result, status } = await ctx.router.decide(item, decider, {
      runId: ctx.runId,
      stage: 6,
      subjectType: 'statement',
      subjectId: item.id,
      stageName: 'normalize',
    });

    if (result) {
      out.push({
        id: item.id,
        normalization: result.value,
        status,
        confidence: result.confidence,
      });
    } else {
      const fallback = s6.tier0(item.text, item.language);
      out.push({
        id: item.id,
        normalization: fallback,
        status,
        confidence: fallback?.confidence ?? 0,
      });
    }
  }

  return out;
}

// S7 — Merge and Reduce

export interface MergeInputItem {
  id: string;
  text: string;
  language: Language;
  type?: string;
  qualityScore?: number;
  embedding?: number[];
}

export interface AutoMergeGroup {
  primaryId: string;
  duplicateIds: string[];
  similarity: number;
  reason: string;
}

export interface MergeReductionResult {
  autoMerges: AutoMergeGroup[];
  reviewPairs: MergeCandidate[];
  blockedPairs: MergeCandidate[];
}

export async function runMergeAndReduce(
  items: MergeInputItem[],
  ctx: StageContext,
): Promise<MergeReductionResult> {
  const s7 = new S7MergeAndReduce();
  const mergedAway = new Set<string>();
  const autoMap = new Map<string, AutoMergeGroup>();
  const reviewPairs: MergeCandidate[] = [];
  const blockedPairs: MergeCandidate[] = [];

  // Sort by qualityScore DESC so highest-quality requirement becomes the primary survivor
  const sorted = [...items].sort((a, b) => (b.qualityScore ?? 100) - (a.qualityScore ?? 100));

  for (let i = 0; i < sorted.length; i++) {
    const primary = sorted[i]!;
    if (mergedAway.has(primary.id)) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const other = sorted[j]!;
      if (mergedAway.has(other.id)) continue;

      const pairInput = { a: primary, b: other };
      const decider: Decider<typeof pairInput, MergeCandidate> = {
        tier0(p): Decision<MergeCandidate> {
          const cand = s7.tier0(p.a, p.b);
          const conf =
            cand.recommendation === 'merge'
              ? Math.max(0.92, cand.similarity)
              : cand.recommendation === 'keep_separate'
                ? 0.95
                : cand.similarity;
          return {
            value: cand,
            confidence: conf,
            tier: 0,
            evidence: [cand.reason],
            version: STAGE_5_8_VERSIONS.s7,
          };
        },
      };

      const { result } = await ctx.router.decide(pairInput, decider, {
        runId: ctx.runId,
        stage: 7,
        subjectType: 'pair',
        subjectId: primary.id,
        stageName: 'merge',
      });

      const verdict = result?.value ?? s7.tier0(primary, other);
      if (verdict.recommendation === 'merge') {
        mergedAway.add(other.id);
        const existing = autoMap.get(primary.id);
        if (existing) {
          existing.duplicateIds.push(other.id);
        } else {
          autoMap.set(primary.id, {
            primaryId: primary.id,
            duplicateIds: [other.id],
            similarity: verdict.similarity,
            reason: verdict.reason,
          });
        }
      } else if (verdict.recommendation === 'review') {
        reviewPairs.push(verdict);
      } else if (verdict.reason.startsWith('Different numeric') || verdict.reason.startsWith('Opposite negation')) {
        blockedPairs.push(verdict);
      }
    }
  }

  return {
    autoMerges: [...autoMap.values()],
    reviewPairs,
    blockedPairs,
  };
}

// S8 — Coverage Ledger & Deterministic Preservation Audit

export interface PreservationAuditPair {
  id: string;
  originalText: string;
  normalizedText: string;
  language: Language;
}

export interface CoverageAuditResult {
  preservationChecks: PreservationCheck[];
  failedPreservation: PreservationCheck[];
  coverageReport: CoverageReport;
  hasUncoveredSegments: boolean;
}

export async function runCoverageAndPreservation(
  pairs: PreservationAuditPair[],
  segments: Segment[],
  ctx: StageContext,
): Promise<CoverageAuditResult> {
  const s8 = new S8CoverageChecker();
  const checks: PreservationCheck[] = [];

  for (const pair of pairs) {
    const decider: Decider<PreservationAuditPair, PreservationCheck> = {
      tier0(p): Decision<PreservationCheck> {
        const res = s8.checkPreservation(
          { id: p.id, text: p.originalText, language: p.language },
          { id: p.id, text: p.normalizedText },
        );
        return {
          value: res,
          confidence: 1.0,
          tier: 0,
          evidence: res.passed
            ? ['preserved']
            : [
                ...(res.lost_numbers.length ? [`lost_numbers:${res.lost_numbers.join(',')}`] : []),
                ...(res.lost_negations ? ['lost_negation'] : []),
                ...(res.lost_modality ? ['lost_modality'] : []),
              ],
          version: STAGE_5_8_VERSIONS.s8,
        };
      },
    };

    const { result } = await ctx.router.decide(pair, decider, {
      runId: ctx.runId,
      stage: 8,
      subjectType: 'statement',
      subjectId: pair.id,
      stageName: 'coverage',
    });

    checks.push(
      result?.value ??
        s8.checkPreservation(
          { id: pair.id, text: pair.originalText, language: pair.language },
          { id: pair.id, text: pair.normalizedText },
        ),
    );
  }

  const ledger = new CoverageLedger();
  ledger.hydrateSegments(segments);
  const coverageReport = ledger.getReport();

  return {
    preservationChecks: checks,
    failedPreservation: checks.filter((c) => !c.passed),
    coverageReport,
    hasUncoveredSegments: s8.findUncoveredSegments(coverageReport),
  };
}
