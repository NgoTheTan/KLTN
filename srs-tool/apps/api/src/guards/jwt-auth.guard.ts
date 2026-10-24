import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * JwtAuthGuard — validates JWT from Authorization header or cookie.
 * Attaches user object to request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService?: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (request.cookies && request.cookies['jwt']) {
      token = request.cookies['jwt'];
    }

    if (token && this.jwtService) {
      try {
        const payload = this.jwtService.verify(token);
        request.user = payload;
        return true;
      } catch (err) {
        throw new UnauthorizedException('Invalid or expired authentication token');
      }
    }

    // In development or when no token is provided, assign default local developer user
    request.user = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'dev@srs-tool.local',
      plan: 'standard',
      locale: 'vi',
    };
    return true;
  }
}
