import { Controller, Post, Param, Body } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  /** POST /agent/sessions/:id/messages — Send message to agent (SSE response) */
  @Post('sessions/:id/messages')
  sendMessage(
    @Param('id') sessionId: string,
    @Body() body: { message: string },
  ) {
    return this.service.sendMessage(sessionId, body.message);
  }
}
