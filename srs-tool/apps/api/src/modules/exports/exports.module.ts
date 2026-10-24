import { Module, forwardRef } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ArchitectureModule } from '../architecture/architecture.module';
import { DiagramsModule } from '../diagrams/diagrams.module';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ArchitectureModule,
    DiagramsModule,
    AuthModule,
    forwardRef(() => ProjectsModule),
  ],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
