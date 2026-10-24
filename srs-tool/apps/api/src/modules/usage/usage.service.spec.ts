import { describe, it, expect, beforeEach } from 'vitest';
import { UsageService } from './usage.service';
import { DatabaseService } from '../../db/database.service';
import { ConfigService } from '@nestjs/config';

describe('UsageService', () => {
  let usageService: UsageService;
  let dbService: DatabaseService;

  beforeEach(() => {
    dbService = new DatabaseService(new ConfigService());
    usageService = new UsageService(dbService);
  });

  it('returns initial usage with full quota', async () => {
    const usage = await usageService.getCurrentUsage('user-1');
    expect(usage.dailyLimitTokens).toBe(100000);
    expect(usage.usedTokens).toBe(0);
    expect(usage.remainingTokens).toBe(100000);
    expect(usage.resetsAt).toBeDefined();
  });

  it('reserves tokens within budget', async () => {
    const reservationId = await usageService.reserve('user-1', 5000);
    expect(reservationId).toBeDefined();
  });

  it('throws ForbiddenException when reservation exceeds remaining quota', async () => {
    // Record usage to exhaust quota
    await usageService.record('user-1', {
      inputTokens: 60000,
      outputTokens: 40000,
      model: 'large',
    });

    const usage = await usageService.getCurrentUsage('user-1');
    expect(usage.remainingTokens).toBe(0);

    await expect(usageService.reserve('user-1', 1000)).rejects.toThrow('Token quota exceeded');
  });

  it('records actual usage and refunds correctly', async () => {
    await usageService.record('user-2', {
      inputTokens: 3000,
      outputTokens: 2000,
      model: 'small',
    });

    let usage = await usageService.getCurrentUsage('user-2');
    expect(usage.usedTokens).toBe(5000);
    expect(usage.remainingTokens).toBe(95000);

    // Refund 1500 tokens
    await usageService.refund('user-2', 1500);
    usage = await usageService.getCurrentUsage('user-2');
    expect(usage.usedTokens).toBe(3500);
    expect(usage.remainingTokens).toBe(96500);
  });
});
