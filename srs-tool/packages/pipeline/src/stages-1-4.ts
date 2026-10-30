/**
 * Stage helpers S1→S4.
 *
 * Pure (DB-free) building blocks that wire the stage classes through the
 * DecisionRouter. The worker owns persistence: it loads inputs from PostgreSQL,
 * calls these helpers, and writes results + decision logs back, which is what makes
 * each stage independently resumable (`fromStage`).
 */

import type { Language, Platform, RequirementType } from '@srs-tool/schemas';
import type { Decider, Decision, DecisionRouter } from './decision/router.js';
import { S2ExtractCandidates, type RequirementCandidate, type SegmentVerdict } from './stages/s2-extract.js';
import { S3ClassifyAndTag, type ClassifyOutput } from './stages/s3-classify-tag.js';
import {
  S4IssueDetector,
  type ChecklistGap,
  type ChecklistTopic,
  type ConflictPair,
  type LintIssue,
} from './stages/s4-issue-detector.js';

export const STAGE_VERSIONS = {
  s2: 'rules-s2@1',
  s3: 'rules-s3@1',
  s4: 'lint-s4@1',
} as const;

/** Default thresholds tuned for tier-0 rule confidences (see stage classes). */
export const DEFAULT_STAGE_THRESHOLDS = {
  extract: { tier0AcceptMin: 0.8, tier1AcceptMin: 0.85 },
  classify: { tier0AcceptMin: 0.8, tier1AcceptMin: 0.75 },
  normalize: { tier0AcceptMin: 0.85, tier1AcceptMin: 0.8 },
  merge: { tier0AcceptMin: 0.92, tier1AcceptMin: 0.85 },
  coverage: { tier0AcceptMin: 1.0, tier1AcceptMin: 0.9 },
} as const;

export interface StageContext {
  runId: string;
  router: DecisionRouter;
}

// S2 — extraction per segment

export interface SegmentInput {
  id: string;
  text: string;
  language: Language;
}

export type SegmentDecisionStatus = 'decided' | 'pending_llm' | 'needs_review';

export interface SegmentExtraction {
  segmentId: string;
  candidates: RequirementCandidate[];
  verdict: SegmentVerdict;
  status: SegmentDecisionStatus;
  confidence: number;
}

export async function runExtraction(segments: SegmentInput[], ctx: StageContext): Promise<SegmentExtraction[]> {
  const s2 = new S2ExtractCandidates();
  const results: SegmentExtraction[] = [];

  for (const seg of segments) {
    const input = { segment_id: seg.id, text: seg.text, language: seg.language };
    const decider: Decider<typeof input, { candidates: RequirementCandidate[]; verdict: SegmentVerdict }> = {
      tier0(i) {
        const candidates = s2.tier0(i);
        const verdict = s2.verdict(i, candidates);
        const top = candidates.reduce((m, c) => Math.max(m, c.confidence), 0);
        // not_requirement is only trusted when there are no hints at all (verdict logic)
        const confidence = verdict === 'not_requirement' ? 0.9 : verdict === 'has_candidates' ? top : Math.min(top || 0.5, 0.7);
        return { value: { candidates, verdict }, confidence, tier: 0, evidence: candidates.map((c) => c.text.slice(0, 80)), version: STAGE_VERSIONS.s2 };
      },
    };

    const { result, status } = await ctx.router.decide(input, decider, {
      runId: ctx.runId,
      stage: 2,
      subjectType: 'segment',
      subjectId: seg.id,
      stageName: 'extract',
    });

    if (result) {
      results.push({ segmentId: seg.id, candidates: result.value.candidates, verdict: result.value.verdict, status, confidence: result.confidence });
    } else {
      // Undecided: keep best-effort tier-0 output so nothing is silently dropped.
      const candidates = s2.tier0(input);
      results.push({ segmentId: seg.id, candidates, verdict: s2.verdict(input, candidates), status, confidence: 0 });
    }
  }
  return results;
}

// S3 — classification per candidate

export interface ClassifiedCandidate {
  candidate: RequirementCandidate;
  classification: ClassifyOutput;
  confidence: number;
  status: SegmentDecisionStatus;
}

export async function runClassification(candidates: RequirementCandidate[], ctx: StageContext): Promise<ClassifiedCandidate[]> {
  const s3 = new S3ClassifyAndTag();
  const out: ClassifiedCandidate[] = [];

  for (const cand of candidates) {
    const decider: Decider<RequirementCandidate, ClassifyOutput> = {
      tier0(c): Decision<ClassifyOutput> {
        const r = s3.tier0(c.text, c.language);
        return {
          value: { type: r.type, platforms: r.platforms, is_asr: r.is_asr, quality_attributes: r.quality_attributes },
          confidence: r.confidence,
          tier: 0,
          evidence: [...r.quality_attributes, ...r.platforms],
          version: STAGE_VERSIONS.s3,
        };
      },
    };

    const { result, status } = await ctx.router.decide(cand, decider, {
      runId: ctx.runId,
      stage: 3,
      subjectType: 'candidate',
      subjectId: cand.id,
      stageName: 'classify',
    });

    if (result) {
      out.push({ candidate: cand, classification: result.value, confidence: result.confidence, status });
    } else {
      const r = s3.tier0(cand.text, cand.language);
      out.push({
        candidate: cand,
        classification: { type: r.type, platforms: r.platforms, is_asr: r.is_asr, quality_attributes: r.quality_attributes },
        confidence: r.confidence,
        status,
      });
    }
  }
  return out;
}

// S4 — issue detection

export interface RequirementIssues {
  candidateId: string;
  issues: LintIssue[];
  qualityScore: number;
}

export interface IssueDetectionResult {
  perRequirement: RequirementIssues[];
  conflicts: ConflictPair[];
  gaps: ChecklistGap[];
}

export function runIssueDetection(
  items: Array<{ id: string; text: string; language: Language; platforms: Platform[] }>,
  options: { checklist?: ChecklistTopic[]; outputLanguage: Language },
): IssueDetectionResult {
  const s4 = new S4IssueDetector();

  const perRequirement = items.map((it) => {
    const issues = s4.lint(it.text, it.language);
    return { candidateId: it.id, issues, qualityScore: s4.qualityScore(issues) };
  });

  const conflicts = s4.detectNumericConflicts(items.map((i) => ({ id: i.id, text: i.text, platforms: i.platforms })));
  const gaps = options.checklist ? s4.checklistGaps(items.map((i) => i.text), options.checklist, options.outputLanguage) : [];

  return { perRequirement, conflicts, gaps };
}

// Requirement code allocation

const TYPE_PREFIX: Record<RequirementType, string> = {
  functional: 'FR',
  'non-functional': 'NFR',
  constraint: 'CON',
  interface: 'IF',
  assumption: 'ASM',
};

const EXPLICIT_CODE = /(?<![\p{L}\p{N}])((?:FR|NFR|CON|IF|ASM)-[A-Z]{2,4}-\d{1,4})(?![\p{L}\p{N}])/iu;

/**
 * Allocates stable, human-readable codes like FR-IOT-012 / NFR-WEB-004.
 * Preserves explicit codes already written in the source text when unused.
 */
export class RequirementCodeAllocator {
  private used = new Set<string>();
  private counters = new Map<string, number>();

  constructor(existingCodes: string[] = []) {
    for (const code of existingCodes) this.register(code);
  }

  private register(code: string): void {
    this.used.add(code);
    const m = /^([A-Z]+-[A-Z]+)-(\d+)$/.exec(code);
    if (m) {
      const n = parseInt(m[2]!, 10);
      this.counters.set(m[1]!, Math.max(this.counters.get(m[1]!) ?? 0, n));
    }
  }

  next(type: RequirementType, platforms: Platform[], sourceText?: string): string {
    if (sourceText) {
      const explicit = EXPLICIT_CODE.exec(sourceText)?.[1]?.toUpperCase();
      if (explicit && !this.used.has(explicit)) {
        this.register(explicit);
        return explicit;
      }
    }
    const platform = platforms.length === 1 && platforms[0] !== 'shared' ? platforms[0]!.toUpperCase() : 'SYS';
    const base = `${TYPE_PREFIX[type]}-${platform}`;
    const n = (this.counters.get(base) ?? 0) + 1;
    const code = `${base}-${String(n).padStart(3, '0')}`;
    this.register(code);
    return code;
  }
}
