import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * JwtAuthGuard — validates JWT from Authorization header or cookie.
 * Applied globally or per-controller.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // TODO: Validate JWT, attach user to request
    // const request = context.switchToHttp().getRequest();
    // const token = this.extractToken(request);
    // if (!token) throw new UnauthorizedException();
    // request.user = this.jwtService.verify(token);
    return true; // placeholder
  }
}
