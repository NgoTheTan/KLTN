import { z } from 'zod';

// Language

export const LanguageSchema = z.enum(['vi', 'en']);
export type Language = z.infer<typeof LanguageSchema>;

// Platform

export const PlatformSchema = z.enum(['web', 'mobile', 'iot', 'shared']);
export type Platform = z.infer<typeof PlatformSchema>;

// Processing Mode

export const ProcessingModeSchema = z.enum(['eco', 'standard', 'thorough']);
export type ProcessingMode = z.infer<typeof ProcessingModeSchema>;

// Decision Tier

export const DecisionTierSchema = z.enum(['rule', 'local', 'llm']);
export type DecisionTier = z.infer<typeof DecisionTierSchema>;

// EARS Pattern

export const EarsPatternSchema = z.enum([
  'ubiquitous',      // Luôn đúng: <System> shall <response>
  'event-driven',    // Theo sự kiện: When <trigger>, <system> shall <response>
  'state-driven',    // Theo trạng thái: While <state>, <system> shall <response>
  'optional',        // Tuỳ chọn: Where <feature>, <system> shall <response>
  'unwanted',        // Không mong muốn: If <condition>, then <system> shall <response>
  'complex',         // Phức hợp
]);
export type EarsPattern = z.infer<typeof EarsPatternSchema>;

// Requirement Type

export const RequirementTypeSchema = z.enum([
  'functional',
  'non-functional',
  'constraint',
  'interface',
  'assumption',
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

// Priority (MoSCoW)

export const PrioritySchema = z.enum(['must', 'should', 'could', 'wont']);
export type Priority = z.infer<typeof PrioritySchema>;

// Origin

export const OriginSchema = z.enum(['explicit', 'inferred', 'assumption']);
export type Origin = z.infer<typeof OriginSchema>;

// Verification Method

export const VerificationMethodSchema = z.enum([
  'test',
  'analysis',
  'inspection',
  'demonstration',
]);
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

// Segment Coverage Status

export const SegmentCoverageStatusSchema = z.enum([
  'unmapped',
  'mapped',
  'not_requirement',
  'unresolved',
]);
export type SegmentCoverageStatus = z.infer<typeof SegmentCoverageStatusSchema>;

// Requirement Status

export const RequirementStatusSchema = z.enum([
  'candidate',
  'classified',
  'needs_clarification',
  'normalized',
  'approved',
  'merged',
  'rejected',
  'deprecated',
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

// Run Status

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_input',
  'over_budget',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// Decision Status

export const DecisionStatusSchema = z.enum([
  'decided',
  'pending_llm',
  'needs_review',
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

// Quality Metric

export const QualityMetricSchema = z.object({
  stimulus_source: z.string().optional(),
  stimulus: z.string().optional(),
  environment: z.string().optional(),
  artifact: z.string().optional(),
  response: z.string().optional(),
  response_measure: z.string().optional(), // Must include number + unit
});
export type QualityMetric = z.infer<typeof QualityMetricSchema>;

// Requirement (normalized)

export const RequirementSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  code: z.string(), // e.g. FR-WEB-001, NFR-IOT-004
  type: RequirementTypeSchema,
  platforms: z.array(PlatformSchema),
  ears_pattern: EarsPatternSchema,
  statement: z.string(),
  statement_original: z.string(),
  language: LanguageSchema,
  rationale: z.string().optional(),
  acceptance_criteria: z.string().optional(), // Given/When/Then
  verification_method: VerificationMethodSchema,
  metric: QualityMetricSchema.optional(),
  is_asr: z.boolean(),
  origin: OriginSchema,
  priority: PrioritySchema,
  status: RequirementStatusSchema,
  quality_score: z.number().int().min(0).max(100),
  issues: z.array(z.string()),
  resolved_by: DecisionTierSchema,
  confidence: z.number().min(0).max(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

// Segment

export const SegmentSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  ordinal: z.number().int(),
  text: z.string(),
  locator: z.record(z.unknown()), // e.g. { page: 3, line: 12 }
  language: LanguageSchema,
  coverage_status: SegmentCoverageStatusSchema,
  resolved_by: DecisionTierSchema.optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

// Decision

export const DecisionSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  evidence: z.array(z.string()),
  version: z.string(),
});
export type Decision<T = unknown> = Omit<z.infer<typeof DecisionSchema>, 'value'> & { value: T };

// Architecture Model

export const ArchElementKindSchema = z.enum([
  'person', 'system', 'container', 'component', 'device', 'datastore',
]);
export type ArchElementKind = z.infer<typeof ArchElementKindSchema>;

export const ArchElementSchema = z.object({
  id: z.string(),
  kind: ArchElementKindSchema,
  name: z.string(),
  description: z.string().optional(),
  technology: z.string().optional(),
  platform: PlatformSchema.optional(),
  parent_id: z.string().optional(),
  requirement_ids: z.array(z.string()),
});
export type ArchElement = z.infer<typeof ArchElementSchema>;

export const ArchRelationshipSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  label: z.string().optional(),
  protocol: z.string().optional(),
  async: z.boolean().optional(),
  requirement_ids: z.array(z.string()),
});
export type ArchRelationship = z.infer<typeof ArchRelationshipSchema>;

export const ViewTypeSchema = z.enum([
  'context', 'container', 'component', 'deployment', 'sequence', 'dataflow', 'er',
]);
export type ViewType = z.infer<typeof ViewTypeSchema>;

export const ArchViewSchema = z.object({
  id: z.string(),
  type: ViewTypeSchema,
  scope_element_id: z.string().optional(),
  include_ids: z.array(z.string()),
  mode: z.enum(['model', 'detached']),
});
export type ArchView = z.infer<typeof ArchViewSchema>;

export const TechChoiceSchema = z.object({
  layer: z.string(),
  choice: z.string(),
  alternatives: z.array(z.string()),
  rationale: z.string(),
  requirement_ids: z.array(z.string()),
});
export type TechChoice = z.infer<typeof TechChoiceSchema>;

export const ArchitectureModelSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  version: z.number().int(),
  language: LanguageSchema,
  elements: z.array(ArchElementSchema),
  relationships: z.array(ArchRelationshipSchema),
  views: z.array(ArchViewSchema),
  tech_choices: z.array(TechChoiceSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ArchitectureModel = z.infer<typeof ArchitectureModelSchema>;

// Project

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  platforms: z.array(PlatformSchema).min(1),
  output_language: LanguageSchema,
  constraints: z.record(z.unknown()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

// Issue

export const IssueSeveritySchema = z.enum(['error', 'warning', 'info']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const IssueKindSchema = z.enum([
  'ambiguous', 'missing', 'conflict', 'terminology', 'incomplete', 'unnormalized',
]);
export type IssueKind = z.infer<typeof IssueKindSchema>;

export const IssueSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  requirement_id: z.string().uuid().optional(),
  segment_id: z.string().uuid().optional(),
  kind: IssueKindSchema,
  rule_id: z.string(),
  severity: IssueSeveritySchema,
  status: z.enum(['open', 'resolved', 'dismissed', 'not_applicable']),
  reason: z.string().optional(),
  created_at: z.string().datetime(),
});
export type Issue = z.infer<typeof IssueSchema>;

// Patch (for Architecture Model editing)

export const PatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_element'), element: ArchElementSchema }),
  z.object({ op: z.literal('remove_element'), element_id: z.string() }),
  z.object({ op: z.literal('update_element'), element_id: z.string(), changes: z.record(z.unknown()) }),
  z.object({ op: z.literal('add_relationship'), relationship: ArchRelationshipSchema }),
  z.object({ op: z.literal('remove_relationship'), relationship_id: z.string() }),
  z.object({ op: z.literal('add_tech_choice'), tech_choice: TechChoiceSchema }),
]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const ModelPatchSchema = z.object({
  operations: z.array(PatchOperationSchema),
  expected_version: z.number().int(),
  reason: z.string().optional(),
});
export type ModelPatch = z.infer<typeof ModelPatchSchema>;

// API Responses

export const CoverageReportSchema = z.object({
  total_segments: z.number().int(),
  mapped: z.number().int(),
  not_requirement: z.number().int(),
  unresolved: z.number().int(),
  unmapped: z.number().int(),
  coverage_pct: z.number().min(0).max(100),
});
export type CoverageReport = z.infer<typeof CoverageReportSchema>;

export const UsageSchema = z.object({
  user_id: z.string().uuid(),
  daily_limit_tokens: z.number().int(),
  used_tokens: z.number().int(),
  remaining_tokens: z.number().int(),
  resets_at: z.string().datetime(),
});
export type Usage = z.infer<typeof UsageSchema>;
