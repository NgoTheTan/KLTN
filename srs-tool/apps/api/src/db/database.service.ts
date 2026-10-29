import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  createDbPool,
  createDb,
  runMigrations,
  type DatabaseInstance,
  schema,
} from '@srs-tool/db';

export type DrizzleDb = DatabaseInstance;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  public pool?: Pool;
  public db?: DrizzleDb;
  public isConnected = false;

  // In-memory fallback stores for offline unit tests / dev
  public memUsers = new Map<string, any>();
  public memProjects = new Map<string, any>();
  public memDocuments = new Map<string, any>();
  public memSegments = new Map<string, any>();
  public memRequirements = new Map<string, any>();
  public memRequirementVersions = new Map<string, any[]>();
  public memRequirementSources = new Map<string, any[]>();
  public memIssues = new Map<string, any>();
  public memQuestions = new Map<string, any>();
  public memGlossary = new Map<string, any>();
  public memArchModels = new Map<string, any>();
  public memDiagrams = new Map<string, any>();
  public memTechRecommendations = new Map<string, any>();
  public memRuns = new Map<string, any>();
  public memUsageLedger: any[] = [];
  public memExports = new Map<string, any>();
  public memAgentSessions = new Map<string, any>();
  public memAgentPatches = new Map<string, any>();
  public memDecisionLogs: any[] = [];

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    if (databaseUrl) {
      try {
        this.pool = createDbPool({
          connectionString: databaseUrl,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        });

        // Quick connection test
        const client = await this.pool.connect();
        client.release();

        // Run migrations
        await runMigrations(this.pool);

        this.db = createDb(this.pool);
        this.isConnected = true;
        this.logger.log('Connected to PostgreSQL successfully with Drizzle ORM and initialized schema');
      } catch (err: any) {
        this.logger.warn(
          `PostgreSQL connection or migration failed (${err.message}). Using in-memory fallback for local development.`,
        );
        this.isConnected = false;
      }
    } else {
      this.logger.log('No DATABASE_URL configured. Running with in-memory storage fallback.');
    }

    // Seed default user if empty
    this.ensureDefaultUser();
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  private ensureDefaultUser() {
    const defaultUserId = '00000000-0000-0000-0000-000000000001';
    if (!this.memUsers.has(defaultUserId)) {
      this.memUsers.set(defaultUserId, {
        id: defaultUserId,
        email: 'dev@srs-tool.local',
        plan: 'standard',
        locale: 'vi',
        dailyLimitTokens: 100000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}
