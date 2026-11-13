import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { UsageService } from '../modules/usage/usage.service';

/**
 * QuotaGuard — checks user's remaining LLM token quota and global monthly budget before allowing LLM runs.
 * Always permits `eco` mode unconditionally (`NFR-LLM-002`: Eco mode consumes 0 LLM tokens).
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private readonly usageService: UsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const mode = request.body?.mode ?? 'standard';

    // Eco mode uses deterministic rules and local models only (0 LLM tokens consumed)
    if (mode === 'eco') {
      return true;
    }

    if (await this.usageService.isGlobalBudgetExceeded()) {
      throw new ForbiddenException(
        'Global monthly LLM budget reached (NFR-LLM-004). Please run in Eco mode (0 token cost).',
      );
    }

    const userId = request.user?.id || '00000000-0000-0000-0000-000000000001';
    const usage = await this.usageService.getCurrentUsage(userId);

    if (usage.remainingTokens <= 0) {
      throw new ForbiddenException(
        'Daily LLM token quota exceeded. Switch to Eco mode (0 token cost) or wait for daily reset at ' +
          usage.resetsAt,
      );
    }

    return true;
  }
}
