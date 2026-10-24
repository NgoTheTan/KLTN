import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  vector,
} from 'drizzle-orm/pg-core';

// 1. Users
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  plan: text('plan').notNull().default('standard'), // 'free' | 'standard' | 'pro'
  locale: text('locale').notNull().default('vi'),
  dailyLimitTokens: integer('daily_limit_tokens').notNull().default(100000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 2. Projects
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  platforms: jsonb('platforms').$type<string[]>().notNull(), // ['web', 'mobile', 'iot', 'shared']
  outputLanguage: text('output_language').notNull().default('vi'),
  constraints: jsonb('constraints').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 3. Documents
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  kind: text('kind').notNull(), // 'srs' | 'text' | 'email'
  s3Key: text('s3_key').notNull(),
  sha256: text('sha256').notNull(),
  filename: text('filename'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 4. Segments
export const segments = pgTable('segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  ordinal: integer('ordinal').notNull(),
  text: text('text').notNull(),
  locator: jsonb('locator').$type<Record<string, unknown>>().default({}),
  language: text('language').notNull().default('vi'),
  coverageStatus: text('coverage_status').notNull().default('unmapped'), // 'unmapped' | 'mapped' | 'not_requirement' | 'unresolved'
  resolvedBy: text('resolved_by'), // 'rule' | 'local' | 'llm'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 5. Requirements
export const requirements = pgTable('requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  code: text('code').notNull(), // e.g. FR-IOT-012, NFR-WEB-004
  type: text('type').notNull(), // 'functional' | 'non-functional' | 'constraint' | 'interface' | 'assumption'
  platforms: jsonb('platforms').$type<string[]>().notNull(),
  earsPattern: text('ears_pattern').notNull(), // 'ubiquitous' | 'event-driven' | 'state-driven' | 'optional' | 'unwanted' | 'complex'
  statement: text('statement').notNull(),
  statementOriginal: text('statement_original').notNull(),
  language: text('language').notNull().default('vi'),
  rationale: text('rationale'),
  acceptanceCriteria: text('acceptance_criteria'),
  verificationMethod: text('verification_method').notNull().default('test'),
  priority: text('priority').notNull().default('should'),
  metric: jsonb('metric').$type<Record<string, unknown>>(),
  isAsr: boolean('is_asr').notNull().default(false),
  origin: text('origin').notNull().default('explicit'), // 'explicit' | 'inferred' | 'assumption'
  status: text('status').notNull().default('candidate'), // 'candidate' | 'classified' | 'needs_clarification' | 'normalized' | 'approved' | 'merged' | 'rejected' | 'deprecated'
  qualityScore: integer('quality_score').notNull().default(100),
  issues: jsonb('issues').$type<string[]>().default([]),
  resolvedBy: text('resolved_by').notNull().default('rule'),
  confidence: real('confidence').notNull().default(1.0),
  embedding: vector('embedding', { dimensions: 384 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 6. Requirement Versions
export const requirementVersions = pgTable(
  'requirement_versions',
  {
    requirementId: uuid('requirement_id')
      .references(() => requirements.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    changedBy: text('changed_by').notNull(), // 'pipeline' | 'user' | 'agent'
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requirementId, t.version] })],
);

// 7. Requirement Sources (many-to-many link between requirements and source segments)
export const requirementSources = pgTable(
  'requirement_sources',
  {
    requirementId: uuid('requirement_id')
      .references(() => requirements.id, { onDelete: 'cascade' })
      .notNull(),
    segmentId: uuid('segment_id')
      .references(() => segments.id, { onDelete: 'cascade' })
      .notNull(),
    quote: text('quote'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requirementId, t.segmentId] })],
);

// 8. Issues
export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  requirementId: uuid('requirement_id').references(() => requirements.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'ambiguous' | 'missing' | 'conflict' | 'terminology' | 'incomplete' | 'unnormalized'
  ruleId: text('rule_id').notNull(),
  severity: text('severity').notNull().default('warning'), // 'error' | 'warning' | 'info'
  status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dismissed' | 'not_applicable'
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 9. Questions (Clarification in Stage 5)
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  options: jsonb('options').$type<string[]>().default([]),
  proposedValue: text('proposed_value'),
  answer: text('answer'),
  answerSegmentId: uuid('answer_segment_id').references(() => segments.id),
  status: text('status').notNull().default('pending'), // 'pending' | 'answered' | 'skipped'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 10. Glossary Terms
export const glossaryTerms = pgTable('glossary_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  termVi: text('term_vi').notNull(),
  termEn: text('term_en').notNull(),
  definition: text('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 11. Architecture Models
export const archModels = pgTable('arch_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  version: integer('version').notNull().default(1),
  language: text('language').notNull().default('vi'),
  body: jsonb('body')
    .$type<{
      elements: any[];
      relationships: any[];
      views: any[];
      tech_choices: any[];
    }>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 12. Diagrams
export const diagrams = pgTable('diagrams', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelId: uuid('model_id')
    .references(() => archModels.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull(), // 'context' | 'container' | 'component' | 'deployment' | 'sequence' | 'dataflow' | 'er'
  mode: text('mode').notNull().default('model'), // 'model' | 'detached'
  puml: text('puml').notNull(),
  svgS3Key: text('svg_s3_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 13. Tech Recommendations
export const techRecommendations = pgTable('tech_recommendations', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelId: uuid('model_id')
    .references(() => archModels.id, { onDelete: 'cascade' })
    .notNull(),
  layer: text('layer').notNull(),
  choice: text('choice').notNull(),
  alternatives: jsonb('alternatives').$type<string[]>().default([]),
  rationale: text('rationale').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 14. Runs
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  kind: text('kind').notNull().default('pipeline'), // 'pipeline' | 'single_stage' | 'architecture'
  mode: text('mode').notNull().default('standard'), // 'eco' | 'standard' | 'thorough'
  fromStage: integer('from_stage').notNull().default(1),
  status: text('status').notNull().default('queued'), // 'queued' | 'running' | 'waiting_input' | 'over_budget' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
  progress: integer('progress').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 15. Usage Ledger (token tracking & accounting)
export const usageLedger = pgTable('usage_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  runId: uuid('run_id'),
  kind: text('kind').notNull(), // 'reserve' | 'actual' | 'refund'
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  model: text('model').notNull().default('none'),
  costUsd: real('cost_usd').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 16. Exports
export const exportsTable = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  formats: jsonb('formats').$type<string[]>().notNull(),
  s3Key: text('s3_key'),
  status: text('status').notNull().default('queued'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 17. Agent Sessions
export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 18. Agent Patches
export const agentPatches = pgTable('agent_patches', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => agentSessions.id, { onDelete: 'cascade' })
    .notNull(),
  modelId: uuid('model_id')
    .references(() => archModels.id, { onDelete: 'cascade' })
    .notNull(),
  patch: jsonb('patch').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 19. Decision Log
export const decisionLog = pgTable('decision_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .references(() => runs.id, { onDelete: 'cascade' })
    .notNull(),
  stage: integer('stage').notNull(),
  subjectType: text('subject_type').notNull(), // 'segment' | 'candidate' | 'pair' | 'statement'
  subjectId: uuid('subject_id'),
  tier: text('tier').notNull(), // 'rule' | 'local' | 'llm'
  confidence: real('confidence').notNull(),
  version: text('version').notNull(),
  status: text('status').notNull().default('decided'), // 'decided' | 'pending_llm' | 'needs_review'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
