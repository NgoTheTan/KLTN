import { Controller, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RateLimitGuard } from '../../guards/rate-limit.guard';

@Controller('agent')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class AgentController {
  constructor(private readonly service: AgentService) {}

  /**
   * POST /agent/sessions — Create a new agent session for a project.
   */
  @Post('sessions')
  createSession(@Body() body: { projectId: string }, @Req() req: any) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.service.createSession(body.projectId, userId);
  }

  /**
   * POST /agent/sessions/:id/messages — Send instruction or message to agent.
   * Proposes patch and returns draft SVG preview.
   */
  @Post('sessions/:id/messages')
  sendMessage(
    @Param('id') sessionId: string,
    @Body() body: { message: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
    return this.service.sendMessage(sessionId, body.message, userId);
  }

  /**
   * POST /agent/patches/:id/accept — User accepts the proposed patch.
   */
  @Post('patches/:id/accept')
  acceptPatch(@Param('id') patchId: string) {
    return this.service.acceptPatch(patchId);
  }

  /**
   * POST /agent/patches/:id/reject — User rejects the proposed patch.
   */
  @Post('patches/:id/reject')
  rejectPatch(@Param('id') patchId: string) {
    return this.service.rejectPatch(patchId);
  }
}
