import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { usageLedger, users } from '../../db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import * as crypto from 'crypto';

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
  private readonly DEFAULT_DAILY_LIMIT = 100000;

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Get current user usage and remaining daily token quota within the current UTC calendar day (NFR-LLM-001).
   */
  async getCurrentUsage(userId: string = '00000000-0000-0000-0000-000000000001'): Promise<UsageSummary> {
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

    let dailyLimitTokens = this.DEFAULT_DAILY_LIMIT;
    let entries: any[] = [];

    if (this.dbService.isConnected && this.dbService.db) {
      const userRows = await this.dbService.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (userRows.length > 0 && typeof userRows[0]!.dailyLimitTokens === 'number') {
        dailyLimitTokens = userRows[0]!.dailyLimitTokens;
      }

      entries = await this.dbService.db
        .select()
        .from(usageLedger)
        .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, startOfTodayUtc)));
    } else {
      const memUser = this.dbService.memUsers.get(userId);
      if (memUser && typeof memUser.dailyLimitTokens === 'number') {
        dailyLimitTokens = memUser.dailyLimitTokens;
      }
      entries = this.dbService.memUsageLedger.filter(
        (e) => e.userId === userId && new Date(e.createdAt) >= startOfTodayUtc,
      );
    }

    const usedTokens = this.computeNetUsedTokens(entries);
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
   * Checks whether global monthly LLM spend exceeds `GLOBAL_MONTHLY_BUDGET_USD` (default $50, NFR-LLM-004).
   */
  async isGlobalBudgetExceeded(): Promise<boolean> {
    const budgetUsd = Number(process.env['GLOBAL_MONTHLY_BUDGET_USD'] ?? 50);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return false;

    const now = new Date();
    const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    let entries: any[] = [];
    if (this.dbService.isConnected && this.dbService.db) {
      entries = await this.dbService.db
        .select()
        .from(usageLedger)
        .where(gte(usageLedger.createdAt, startOfMonthUtc));
    } else {
      entries = this.dbService.memUsageLedger.filter((e) => new Date(e.createdAt) >= startOfMonthUtc);
    }

    let totalCostUsd = 0;
    for (const e of entries) {
      if (e.kind === 'actual') {
        totalCostUsd += Number(e.costUsd || 0);
      }
    }
    return totalCostUsd >= budgetUsd;
  }

  /**
   * Reserve tokens before starting an LLM run.
   * If mode is 'eco', tokens = 0 (no quota reserved).
   */
  async reserve(userId: string, estimatedTokens: number, runId?: string): Promise<string> {
    const reservationId = crypto.randomUUID();

    if (estimatedTokens > 0) {
      if (await this.isGlobalBudgetExceeded()) {
        throw new ForbiddenException(
          'Global monthly LLM budget reached (NFR-LLM-004). Switch to Eco mode (0 token cost).',
        );
      }
      const usage = await this.getCurrentUsage(userId);
      if (usage.remainingTokens < estimatedTokens) {
        throw new ForbiddenException(
          `Token quota exceeded. Required: ${estimatedTokens}, Available: ${usage.remainingTokens}. Try Eco mode or wait for daily reset.`,
        );
      }
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
      await this.dbService.db.insert(usageLedger).values(entry);
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
      await this.dbService.db.insert(usageLedger).values(entry);
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
      await this.dbService.db.insert(usageLedger).values(entry);
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
      return await this.dbService.db
        .select()
        .from(usageLedger)
        .where(eq(usageLedger.userId, userId))
        .orderBy(desc(usageLedger.createdAt));
    }
    return this.dbService.memUsageLedger.filter((e) => e.userId === userId);
  }

  /**
   * Computes net used tokens across `reserve`, `actual`, and `refund`:
   * - `actual` adds `inputTokens + outputTokens` and marks `runId` as settled (superseding its `reserve`).
   * - `reserve` adds `inputTokens + outputTokens` if its `runId` has not yet been settled by an `actual` entry.
   * - `refund` subtracts `inputTokens + outputTokens`.
   */
  private computeNetUsedTokens(entries: any[]): number {
    const settledRunIds = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'actual' && e.runId) {
        settledRunIds.add(e.runId);
      }
    }

    let total = 0;
    for (const e of entries) {
      const amount = (e.inputTokens || 0) + (e.outputTokens || 0);
      if (e.kind === 'actual') {
        total += amount;
      } else if (e.kind === 'reserve') {
        if (!e.runId || !settledRunIds.has(e.runId)) {
          total += amount;
        }
      } else if (e.kind === 'refund') {
        total -= amount;
      }
    }

    return Math.max(0, total);
  }

  private estimateCost(inTokens: number, outTokens: number, _model: string): number {
    // Blended estimate approx $0.0015 / 1k input, $0.002 / 1k output
    return (inTokens / 1000) * 0.0015 + (outTokens / 1000) * 0.002;
  }
}
