import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /**
   * POST /auth/dev-token — Quick development login/token endpoint (disabled in production).
   */
  @Post('dev-token')
  devToken(@Body() body: { email?: string }) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenException('dev-token endpoint is disabled in production');
    }
    return this.service.loginDev(body?.email || 'dev@srs-tool.local');
  }

  /**
   * POST /auth/login — OAuth callback or simulated login.
   */
  @Post('login')
  login(@Body() body: { email: string; provider?: 'google' | 'github' }) {
    return this.service.loginDev(body.email);
  }

  /**
   * GET /auth/me — Current authenticated user profile.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any) {
    return this.service.getProfile(req.user.id);
  }

  /**
   * PATCH /auth/me — Update user locale ('vi' | 'en'). Self-escalation of `plan` is rejected.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@Req() req: any, @Body() body: { locale?: string }) {
    return this.service.updateProfile(req.user.id, { locale: body?.locale });
  }
}
