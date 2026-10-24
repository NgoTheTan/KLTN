import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { usageLedger } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';

export interface UsageSummary {
  userId: string;
  dailyLimitTokens: number;
  usedTokens: number;
  remainingTokens: number;
  resetsAt: string;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Get current user usage and remaining daily token quota.
   */
  async getCurrentUsage(userId: string = '00000000-0000-0000-0000-000000000001'): Promise<UsageSummary> {
    const dailyLimitTokens = 100000; // Default daily budget: 100k tokens per user

    // Compute reset time at next midnight UTC
    const now = new Date();
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

    let usedTokens = 0;

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        const entries = await this.dbService.db
          .select()
          .from(usageLedger)
          .where(eq(usageLedger.userId, userId));

        for (const entry of entries) {
          if (entry.kind === 'actual') {
            usedTokens += (entry.inputTokens || 0) + (entry.outputTokens || 0);
          } else if (entry.kind === 'refund') {
            usedTokens = Math.max(0, usedTokens - (entry.outputTokens || 0));
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to query usage_ledger table (${err.message}). Using memory fallback.`);
        usedTokens = this.calculateMemUsage(userId);
      }
    } else {
      usedTokens = this.calculateMemUsage(userId);
    }

    const remainingTokens = Math.max(0, dailyLimitTokens - usedTokens);

    return {
      userId,
      dailyLimitTokens,
      usedTokens,
      remainingTokens,
      resetsAt,
    };
  }

  /**
   * Reserve tokens before starting an LLM run.
   * If mode is 'eco', tokens = 0 (no quota reserved).
   */
  async reserve(userId: string, estimatedTokens: number, runId?: string): Promise<string> {
    const reservationId = crypto.randomUUID();
    const usage = await this.getCurrentUsage(userId);

    if (estimatedTokens > 0 && usage.remainingTokens < estimatedTokens) {
      throw new ForbiddenException(
        `Token quota exceeded. Required: ${estimatedTokens}, Available: ${usage.remainingTokens}. Try Eco mode or wait for daily reset.`,
      );
    }

    const entry = {
      id: reservationId,
      userId,
      runId: runId ?? null,
      kind: 'reserve',
      inputTokens: estimatedTokens,
      outputTokens: 0,
      model: 'estimated',
      costUsd: 0,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(usageLedger).values(entry);
      } catch {
        this.dbService.memUsageLedger.push(entry);
      }
    } else {
      this.dbService.memUsageLedger.push(entry);
    }

    this.logger.log(`Reserved ${estimatedTokens} tokens for user=${userId} (reservation=${reservationId})`);
    return reservationId;
  }

  /**
   * Record actual token consumption after LLM execution.
   */
  async record(
    userId: string,
    actual: { inputTokens: number; outputTokens: number; model: string; runId?: string },
  ): Promise<string> {
    const entryId = crypto.randomUUID();
    const entry = {
      id: entryId,
      userId,
      runId: actual.runId ?? null,
      kind: 'actual',
      inputTokens: actual.inputTokens,
      outputTokens: actual.outputTokens,
      model: actual.model,
      costUsd: this.estimateCost(actual.inputTokens, actual.outputTokens, actual.model),
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(usageLedger).values(entry);
      } catch {
        this.dbService.memUsageLedger.push(entry);
      }
    } else {
      this.dbService.memUsageLedger.push(entry);
    }

    this.logger.log(
      `Recorded usage for user=${userId}: ${actual.inputTokens}in + ${actual.outputTokens}out (${actual.model})`,
    );
    return entryId;
  }

  /**
   * Refund unused token reservation.
   */
  async refund(userId: string, refundTokens: number, runId?: string): Promise<void> {
    const entry = {
      id: crypto.randomUUID(),
      userId,
      runId: runId ?? null,
      kind: 'refund',
      inputTokens: 0,
      outputTokens: refundTokens,
      model: 'refund',
      costUsd: 0,
      createdAt: new Date(),
    };

    if (this.dbService.isConnected && this.dbService.db) {
      try {
        await this.dbService.db.insert(usageLedger).values(entry);
      } catch {
        this.dbService.memUsageLedger.push(entry);
      }
    } else {
      this.dbService.memUsageLedger.push(entry);
    }

    this.logger.log(`Refunded ${refundTokens} tokens for user=${userId}`);
  }

  /**
   * Get full ledger history for user/admin.
   */
  async getLedger(userId: string) {
    if (this.dbService.isConnected && this.dbService.db) {
      try {
        return await this.dbService.db
          .select()
          .from(usageLedger)
          .where(eq(usageLedger.userId, userId))
          .orderBy(desc(usageLedger.createdAt));
      } catch {
        return this.dbService.memUsageLedger.filter((e) => e.userId === userId);
      }
    }
    return this.dbService.memUsageLedger.filter((e) => e.userId === userId);
  }

  private calculateMemUsage(userId: string): number {
    let used = 0;
    for (const e of this.dbService.memUsageLedger) {
      if (e.userId === userId) {
        if (e.kind === 'actual') used += (e.inputTokens || 0) + (e.outputTokens || 0);
        else if (e.kind === 'refund') used = Math.max(0, used - (e.outputTokens || 0));
      }
    }
    return used;
  }

  private estimateCost(inTokens: number, outTokens: number, model: string): number {
    // Blended estimate approx $0.0015 / 1k input, $0.002 / 1k output
    return (inTokens / 1000) * 0.0015 + (outTokens / 1000) * 0.002;
  }
}
