import { z, ZodSchema } from 'zod';

// Types

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequestOptions {
  model?: 'small' | 'large';
  maxTokens?: number;
  temperature?: number;
  /** If provided, output will be validated against this schema */
  schema?: ZodSchema;
  /** Batch ID for grouping related requests */
  batchId?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmResponse<T = string> {
  content: T;
  usage: LlmUsage;
  cached: boolean;
}

export interface TokenReservation {
  reservationId: string;
  estimatedTokens: number;
}

/** Callback to record token usage (injected from UsageLedger) */
export type UsageRecorder = (
  reservationId: string,
  actual: LlmUsage,
) => Promise<void>;

// LLM Gateway

export interface LlmGatewayConfig {
  provider: 'openai' | 'anthropic' | 'google';
  smallModel: string;
  largeModel: string;
  apiKey: string;
  baseUrl?: string;
  dailyBudgetUsd?: number;
}

/**
 * LlmGateway is the single point of access for all LLM calls in the system.
 * Business logic MUST NOT call LLM provider SDKs directly.
 *
 * Responsibilities:
 * - Route to small or large model based on options
 * - Validate structured output against Zod schema
 * - Record token usage via UsageRecorder callback
 * - Enforce quota (throws LlmQuotaExceededError when over limit)
 * - Cache responses keyed by hash(content + promptVersion + model)
 */
export class LlmGateway {
  private config: LlmGatewayConfig;
  private usageRecorder?: UsageRecorder;

  constructor(config: LlmGatewayConfig, usageRecorder?: UsageRecorder) {
    this.config = config;
    this.usageRecorder = usageRecorder;
  }

  /**
   * Reserve token budget before starting a job.
   * Must be called before generate(); returns a reservationId.
   */
  async reserve(estimatedTokens: number, userId: string): Promise<TokenReservation> {
    // TODO: Check user quota, create reservation record in DB
    const reservationId = crypto.randomUUID();
    return { reservationId, estimatedTokens };
  }

  /**
   * Generate a completion. Supports structured output via Zod schema.
   */
  async generate<T = string>(
    messages: LlmMessage[],
    options: LlmRequestOptions = {},
    reservationId?: string,
  ): Promise<LlmResponse<T>> {
    const { model = 'small', maxTokens = 1000, schema } = options;

    // TODO: Implement caching keyed by hash(messages + model + promptVersion)
    // TODO: Call provider SDK (openai, anthropic, google)
    // TODO: Validate against schema if provided
    // TODO: Record usage via this.usageRecorder

    throw new Error('LlmGateway.generate() not yet implemented');
  }

  /**
   * Batch generate: send multiple items in one API call.
   * More efficient than calling generate() in a loop.
   */
  async batchGenerate<T = string>(
    batches: Array<{ messages: LlmMessage[]; id: string }>,
    options: LlmRequestOptions = {},
    reservationId?: string,
  ): Promise<Array<LlmResponse<T> & { id: string }>> {
    // TODO: Implement batch processing with prompt caching
    throw new Error('LlmGateway.batchGenerate() not yet implemented');
  }
}

// Errors

export class LlmQuotaExceededError extends Error {
  constructor(public readonly userId: string, public readonly remaining: number) {
    super(`LLM quota exceeded for user ${userId}. Remaining: ${remaining} tokens.`);
    this.name = 'LlmQuotaExceededError';
  }
}

export class LlmSchemaValidationError extends Error {
  constructor(public readonly zodError: z.ZodError) {
    super(`LLM output failed schema validation: ${zodError.message}`);
    this.name = 'LlmSchemaValidationError';
  }
}

export class LlmBudgetExceededError extends Error {
  constructor() {
    super('System-wide LLM daily budget exceeded. Falling back to rule/local mode.');
    this.name = 'LlmBudgetExceededError';
  }
}
