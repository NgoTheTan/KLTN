import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';

/**
 * RateLimitGuard — sliding window rate limiter backed by Redis or memory.
 * Different limits per endpoint type (upload, agent, general).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const userId = req.user?.id || 'anonymous';
    const path = req.url || '';

    // Determine limit and window based on path
    let limit = 100; // general: 100 req/min
    if (path.includes('/documents')) {
      limit = 10; // uploads: 10 req/min
    } else if (path.includes('/agent')) {
      limit = 30; // agent: 30 req/min
    }

    const key = `rl:${userId}:${clientIp}:${path.split('/')[1] || 'root'}`;
    const now = Date.now();
    const windowMs = 60 * 1000;

    const timestamps = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Please wait before retrying.',
          retryAfterMs: windowMs - (now - timestamps[0]),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }
}

