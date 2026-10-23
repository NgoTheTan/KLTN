import type { LlmGateway } from '@srs-tool/llm';
import type { ProcessingMode } from '@srs-tool/schemas';

// Decision types

export interface Decision<T> {
  value: T;
  confidence: number;
  tier: 0 | 1 | 2;
  evidence: string[];
  version: string;
}

export interface DecisionLog {
  id: string;
  runId: string;
  stage: number;
  subjectType: string;
  subjectId: string;
  tier: 'rule' | 'local' | 'llm';
  confidence: number;
  version: string;
  status: 'decided' | 'pending_llm' | 'needs_review';
  decidedAt: Date;
}

// Decider interface

/**
 * A Decider encapsulates the three-tier logic for a single decision type.
 * Each pipeline stage creates one or more Deciders.
 *
 * Tier 0 (rule): deterministic rules (regex, dictionary, SQL, lint)
 * Tier 1 (local): local ML models (embedding, NLI, classifier)
 * Tier 2 (llm): LLM via LlmGateway, batch-processed, last resort
 */
export interface Decider<I, O> {
  /** Tier 0: deterministic rules. Return null if cannot decide. */
  tier0(input: I): Decision<O> | null;
  /** Tier 1: local ML model. Return null if cannot decide. */
  tier1?(input: I): Promise<Decision<O> | null>;
  /** Tier 2: LLM (batched). Called only when mode allows and quota available. */
  tier2?(batch: I[]): Promise<Array<Decision<O>>>;
}

// Stage config

export interface StageThresholds {
  tier0AcceptMin: number;
  tier1AcceptMin: number;
}

// Decision Router

export interface DecisionRouterConfig {
  mode: ProcessingMode;
  stageThresholds: Record<string, StageThresholds>;
  llmGateway?: LlmGateway;
  onLog?: (log: Omit<DecisionLog, 'id' | 'decidedAt'>) => Promise<void>;
}

/**
 * DecisionRouter implements the three-tier decision logic described in the SRS.
 *
 * For each item:
 * 1. Try Tier 0 (rules). Accept if confidence ≥ tier0AcceptMin.
 * 2. If not accepted, try Tier 1 (local models). Accept if confidence ≥ tier1AcceptMin.
 * 3. If not accepted and mode allows LLM and quota available, batch to Tier 2.
 * 4. Otherwise, mark as 'needs_review' or 'pending_llm'.
 *
 * Every decision is logged with tier, confidence, and version.
 */
export class DecisionRouter {
  constructor(private readonly config: DecisionRouterConfig) {}

  async decide<I, O>(
    input: I,
    decider: Decider<I, O>,
    context: {
      runId: string;
      stage: number;
      subjectType: string;
      subjectId: string;
      stageName: string;
    },
  ): Promise<{ result: Decision<O> | null; status: DecisionLog['status'] }> {
    const thresholds = this.config.stageThresholds[context.stageName] ?? {
      tier0AcceptMin: 0.9,
      tier1AcceptMin: 0.85,
    };

    // Tier 0: Rules
    const t0 = decider.tier0(input);
    if (t0 && t0.confidence >= thresholds.tier0AcceptMin) {
      await this.log({ ...context, tier: 'rule', confidence: t0.confidence, version: t0.version, status: 'decided' });
      return { result: t0, status: 'decided' };
    }

    // Tier 1: Local Models
    if (decider.tier1) {
      const t1 = await decider.tier1(input);
      if (t1 && t1.confidence >= thresholds.tier1AcceptMin) {
        await this.log({ ...context, tier: 'local', confidence: t1.confidence, version: t1.version, status: 'decided' });
        return { result: t1, status: 'decided' };
      }
    }

    // Tier 2: LLM
    const canUseLlm =
      this.config.mode !== 'eco' &&
      this.config.llmGateway != null &&
      decider.tier2 != null;

    if (canUseLlm) {
      // Will be batched by the stage processor; mark as pending for now
      await this.log({ ...context, tier: 'llm', confidence: 0, version: 'pending', status: 'pending_llm' });
      return { result: null, status: 'pending_llm' };
    }

    // Cannot decide
    await this.log({ ...context, tier: 'rule', confidence: t0?.confidence ?? 0, version: t0?.version ?? 'n/a', status: 'needs_review' });
    return { result: null, status: 'needs_review' };
  }

  private async log(entry: Omit<DecisionLog, 'id' | 'decidedAt'>): Promise<void> {
    if (this.config.onLog) {
      await this.config.onLog(entry);
    }
  }
}
