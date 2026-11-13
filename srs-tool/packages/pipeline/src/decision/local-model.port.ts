/**
 * LocalModelPort (Tier 1 — CPU Local ML Port)
 *
 * Abstracts local multilingual embedding (384-d), Natural Language Inference (NLI),
 * and lightweight candidate classification so @srs-tool/pipeline remains pure and
 * testable while allowing @srs-tool/worker to inject ONNX / Transformers.js in Phase 4.
 */

export interface NliPrediction {
  label: 'entailment' | 'contradiction' | 'neutral';
  score: number;
}

export interface LocalModelPort {
  readonly modelVersion: string;

  /** Compute normalized 384-dimensional multilingual embeddings for a batch of texts. */
  embed(texts: string[]): Promise<number[][]>;

  /** Run Natural Language Inference between premise and hypothesis. */
  nli(premise: string, hypothesis: string): Promise<NliPrediction>;

  /** Optional lightweight binary requirement classifier on top of embeddings. */
  classifyRequirement?(
    text: string,
    language: 'vi' | 'en',
  ): Promise<{ isRequirement: boolean; confidence: number }>;
}
