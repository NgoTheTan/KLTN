// Decision Router
export { DecisionRouter } from './decision/router.js';
export type { Decision, DecisionLog, Decider, DecisionRouterConfig, StageThresholds } from './decision/router.js';

// Coverage Ledger
export { CoverageLedger } from './ledger/coverage.js';

// Stage Processors
export { S1ParseAndSegment } from './stages/s1-parse-segment.js';
export type { ParseSegmentInput, ParseSegmentOutput } from './stages/s1-parse-segment.js';

export { S2ExtractCandidates } from './stages/s2-extract.js';
export type { RequirementCandidate, S2Input, S2Output, SegmentVerdict } from './stages/s2-extract.js';

export { S3ClassifyAndTag } from './stages/s3-classify-tag.js';
export type { ClassifyOutput, Tier0ClassifyResult } from './stages/s3-classify-tag.js';

export { S4IssueDetector } from './stages/s4-issue-detector.js';
export type { LintIssue, ChecklistTopic, ChecklistGap, ConflictPair, RequirementForConflict } from './stages/s4-issue-detector.js';

// S1→S4 orchestration helpers (DB-free; worker handles persistence)
export {
  runExtraction,
  runClassification,
  runIssueDetection,
  RequirementCodeAllocator,
  DEFAULT_STAGE_THRESHOLDS,
  STAGE_VERSIONS,
} from './stages-1-4.js';
export type {
  StageContext,
  SegmentInput,
  SegmentExtraction,
  SegmentDecisionStatus,
  ClassifiedCandidate,
  RequirementIssues,
  IssueDetectionResult,
} from './stages-1-4.js';

export { wordsRegex, countWord, splitSentences } from './text.js';

export { S5QuestionBuilder } from './stages/s5-question-builder.js';
export type { ClarificationQuestion } from './stages/s5-question-builder.js';

export { S6Normalizer } from './stages/s6-normalizer.js';
export type { NormalizationResult } from './stages/s6-normalizer.js';

export { S7MergeAndReduce } from './stages/s7-merge-reduce.js';
export type { MergeCandidate } from './stages/s7-merge-reduce.js';

export { S8CoverageChecker } from './stages/s8-coverage-checker.js';
export type { PreservationCheck } from './stages/s8-coverage-checker.js';
