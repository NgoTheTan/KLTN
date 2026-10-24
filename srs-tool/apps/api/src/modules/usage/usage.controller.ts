import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('me')
export class UsageController {
  constructor(private readonly service: UsageService) {}

  /**
   * GET /me/usage — Current user quota and usage.
   * Returns daily_limit_tokens, used_tokens, remaining_tokens, resets_at.
   */
  @Get('usage')
  getUsage(@Req() req: any) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.service.getCurrentUsage(userId);
  }

  /**
   * GET /me/usage/ledger — Detailed token transaction ledger.
   */
  @Get('usage/ledger')
  getLedger(@Req() req: any) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.service.getLedger(userId);
  }
}
