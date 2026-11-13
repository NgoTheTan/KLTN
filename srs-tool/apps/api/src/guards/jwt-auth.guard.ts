import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * JwtAuthGuard — validates JWT from Authorization header or cookie.
 * In production (`NODE_ENV === 'production'`), missing or invalid tokens are strictly rejected with 401.
 * In local development/test without a token, falls back to the seeded local developer identity.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Optional() private readonly jwtService?: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.['authorization'];
    let token: string | undefined;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (request.cookies && request.cookies['jwt']) {
      token = request.cookies['jwt'];
    } else if (typeof request.query?.['token'] === 'string') {
      // Allow SSE EventSource token query param when Authorization headers cannot be set
      token = request.query['token'];
    }

    if (token) {
      if (!this.jwtService) {
        throw new UnauthorizedException('Authentication service unavailable');
      }
      try {
        const payload = this.jwtService.verify(token);
        request.user = payload;
        return true;
      } catch {
        throw new UnauthorizedException('Invalid or expired authentication token');
      }
    }

    if (process.env['NODE_ENV'] === 'production') {
      throw new UnauthorizedException('Authentication token is required');
    }

    // Local development / offline test fallback user
    request.user = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'dev@srs-tool.local',
      plan: 'standard',
      locale: 'vi',
    };
    return true;
  }
}
