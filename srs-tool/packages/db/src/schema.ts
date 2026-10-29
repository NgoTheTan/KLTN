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
  index,
} from 'drizzle-orm/pg-core';
import { relations, type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

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
export const projects = pgTable(
  'projects',
  {
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
  },
  (t) => [index('projects_owner_idx').on(t.ownerId)],
);

// 3. Documents
export const documents = pgTable(
  'documents',
  {
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
  },
  (t) => [index('documents_project_idx').on(t.projectId)],
);

// 4. Segments
export const segments = pgTable(
  'segments',
  {
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
  },
  (t) => [
    index('segments_project_idx').on(t.projectId),
    index('segments_doc_idx').on(t.documentId),
    index('segments_coverage_idx').on(t.coverageStatus),
  ],
);

// 5. Requirements
export const requirements = pgTable(
  'requirements',
  {
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
  },
  (t) => [
    index('requirements_project_idx').on(t.projectId),
    index('requirements_code_idx').on(t.code),
    index('requirements_status_idx').on(t.status),
    index('requirements_type_idx').on(t.type),
  ],
);

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
export const issues = pgTable(
  'issues',
  {
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
  },
  (t) => [index('issues_project_idx').on(t.projectId)],
);

// 9. Questions (Clarification in Stage 5)
export const questions = pgTable(
  'questions',
  {
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
  },
  (t) => [index('questions_project_idx').on(t.projectId)],
);

// 10. Glossary Terms
export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    termVi: text('term_vi').notNull(),
    termEn: text('term_en').notNull(),
    definition: text('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('glossary_project_idx').on(t.projectId)],
);

// 11. Architecture Models
export const archModels = pgTable(
  'arch_models',
  {
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
  },
  (t) => [index('arch_models_project_idx').on(t.projectId)],
);

// 12. Diagrams
export const diagrams = pgTable(
  'diagrams',
  {
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
  },
  (t) => [index('diagrams_model_idx').on(t.modelId)],
);

// 13. Tech Recommendations
export const techRecommendations = pgTable(
  'tech_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id')
      .references(() => archModels.id, { onDelete: 'cascade' })
      .notNull(),
    layer: text('layer').notNull(),
    choice: text('choice').notNull(),
    alternatives: jsonb('alternatives').$type<string[]>().default([]),
    rationale: text('rationale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tech_recs_model_idx').on(t.modelId)],
);

// 14. Runs
export const runs = pgTable(
  'runs',
  {
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
  },
  (t) => [index('runs_project_idx').on(t.projectId)],
);

// 15. Usage Ledger (token tracking & accounting)
export const usageLedger = pgTable(
  'usage_ledger',
  {
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
  },
  (t) => [index('usage_user_idx').on(t.userId), index('usage_run_idx').on(t.runId)],
);

// 16. Exports
export const exportsTable = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    formats: jsonb('formats').$type<string[]>().notNull(),
    s3Key: text('s3_key'),
    status: text('status').notNull().default('queued'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('exports_project_idx').on(t.projectId)],
);

// 17. Agent Sessions
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_sessions_project_idx').on(t.projectId)],
);

// 18. Agent Patches
export const agentPatches = pgTable(
  'agent_patches',
  {
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
  },
  (t) => [index('agent_patches_session_idx').on(t.sessionId), index('agent_patches_model_idx').on(t.modelId)],
);

// 19. Decision Log
export const decisionLog = pgTable(
  'decision_log',
  {
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
  },
  (t) => [index('decision_log_run_idx').on(t.runId)],
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  usageLedger: many(usageLedger),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  documents: many(documents),
  segments: many(segments),
  requirements: many(requirements),
  issues: many(issues),
  questions: many(questions),
  glossaryTerms: many(glossaryTerms),
  archModels: many(archModels),
  runs: many(runs),
  exports: many(exportsTable),
  agentSessions: many(agentSessions),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  segments: many(segments),
}));

export const segmentsRelations = relations(segments, ({ one, many }) => ({
  document: one(documents, {
    fields: [segments.documentId],
    references: [documents.id],
  }),
  project: one(projects, {
    fields: [segments.projectId],
    references: [projects.id],
  }),
  sources: many(requirementSources),
}));

export const requirementsRelations = relations(requirements, ({ one, many }) => ({
  project: one(projects, {
    fields: [requirements.projectId],
    references: [projects.id],
  }),
  versions: many(requirementVersions),
  sources: many(requirementSources),
  issues: many(issues),
}));

export const archModelsRelations = relations(archModels, ({ one, many }) => ({
  project: one(projects, {
    fields: [archModels.projectId],
    references: [projects.id],
  }),
  diagrams: many(diagrams),
  techRecommendations: many(techRecommendations),
  agentPatches: many(agentPatches),
}));

// Inferred TypeScript Model Types
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Project = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;

export type Document = InferSelectModel<typeof documents>;
export type NewDocument = InferInsertModel<typeof documents>;

export type Segment = InferSelectModel<typeof segments>;
export type NewSegment = InferInsertModel<typeof segments>;

export type Requirement = InferSelectModel<typeof requirements>;
export type NewRequirement = InferInsertModel<typeof requirements>;

export type RequirementVersion = InferSelectModel<typeof requirementVersions>;
export type NewRequirementVersion = InferInsertModel<typeof requirementVersions>;

export type RequirementSource = InferSelectModel<typeof requirementSources>;
export type NewRequirementSource = InferInsertModel<typeof requirementSources>;

export type Issue = InferSelectModel<typeof issues>;
export type NewIssue = InferInsertModel<typeof issues>;

export type Question = InferSelectModel<typeof questions>;
export type NewQuestion = InferInsertModel<typeof questions>;

export type GlossaryTerm = InferSelectModel<typeof glossaryTerms>;
export type NewGlossaryTerm = InferInsertModel<typeof glossaryTerms>;

export type ArchModel = InferSelectModel<typeof archModels>;
export type NewArchModel = InferInsertModel<typeof archModels>;

export type Diagram = InferSelectModel<typeof diagrams>;
export type NewDiagram = InferInsertModel<typeof diagrams>;

export type TechRecommendation = InferSelectModel<typeof techRecommendations>;
export type NewTechRecommendation = InferInsertModel<typeof techRecommendations>;

export type Run = InferSelectModel<typeof runs>;
export type NewRun = InferInsertModel<typeof runs>;

export type UsageLedgerEntry = InferSelectModel<typeof usageLedger>;
export type NewUsageLedgerEntry = InferInsertModel<typeof usageLedger>;

export type ExportRecord = InferSelectModel<typeof exportsTable>;
export type NewExportRecord = InferInsertModel<typeof exportsTable>;

export type AgentSession = InferSelectModel<typeof agentSessions>;
export type NewAgentSession = InferInsertModel<typeof agentSessions>;

export type AgentPatch = InferSelectModel<typeof agentPatches>;
export type NewAgentPatch = InferInsertModel<typeof agentPatches>;

export type DecisionLogEntry = InferSelectModel<typeof decisionLog>;
export type NewDecisionLogEntry = InferInsertModel<typeof decisionLog>;
