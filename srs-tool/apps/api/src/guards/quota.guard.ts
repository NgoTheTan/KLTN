import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

/**
 * QuotaGuard — checks user's remaining LLM token quota before allowing pipeline runs.
 * Skips check for eco mode (no LLM tokens consumed).
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // TODO: Read user from request, check remaining quota from UsageService
    // const request = context.switchToHttp().getRequest();
    // const mode = request.body?.mode;
    // if (mode === 'eco') return true; // Eco mode uses no LLM tokens
    // if (user.remainingTokens <= 0) throw new ForbiddenException('Token quota exceeded');
    return true; // placeholder
  }
}
