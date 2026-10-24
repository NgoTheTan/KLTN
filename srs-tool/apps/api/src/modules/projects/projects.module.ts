import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SseService } from './sse.service';
import { UsageModule } from '../usage/usage.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UsageModule, AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, SseService],
  exports: [ProjectsService, SseService],
})
export class ProjectsModule {}
