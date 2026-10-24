import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module';
import { PortsModule } from './ports/ports.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { ArchitectureModule } from './modules/architecture/architecture.module';
import { DiagramsModule } from './modules/diagrams/diagrams.module';
import { AgentModule } from './modules/agent/agent.module';
import { ExportsModule } from './modules/exports/exports.module';
import { UsageModule } from './modules/usage/usage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    PortsModule,
    AuthModule,
    ProjectsModule,
    IngestionModule,
    RequirementsModule,
    ArchitectureModule,
    DiagramsModule,
    AgentModule,
    ExportsModule,
    UsageModule,
  ],
})
export class AppModule {}
