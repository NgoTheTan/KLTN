import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ArchitectureModule } from '../architecture/architecture.module';
import { UsageModule } from '../usage/usage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ArchitectureModule, UsageModule, AuthModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
