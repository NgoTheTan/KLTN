import { Injectable } from '@nestjs/common';

@Injectable()
export class UsageService {
  // TODO: reserve(), record(), refund() for LLM token ledger
  // Token quota check used by QuotaGuard
  async getCurrentUsage() {
    return { daily_limit_tokens: 100000, used_tokens: 0, remaining_tokens: 100000 };
  }
  async reserve(userId: string, estimated: number): Promise<string> {
    return crypto.randomUUID(); // reservationId
  }
  async record(reservationId: string, actual: { inputTokens: number; outputTokens: number; model: string }) {}
  async refund(reservationId: string, refundTokens: number) {}
}
