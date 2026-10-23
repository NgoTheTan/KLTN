import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentService {
  // TODO: Fixed commands → CommandParser (no LLM)
  // Free-form → LLM tool-calling loop (bounded steps + tokens)
  // Agent only proposes patches; user must approve before write
  async sendMessage(sessionId: string, message: string) {
    return { sessionId, pending: true };
  }
}
