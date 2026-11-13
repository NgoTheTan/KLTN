import type { Job } from 'bullmq';
import { eq, ne, and } from 'drizzle-orm';
import { loadTechCatalog, loadTacticsCatalog } from '@srs-tool/knowledge';
import { generateDiagram } from '@srs-tool/plantuml-gen';
import { schema, type DatabaseInstance } from '@srs-tool/db';
import type { ArchitectureModel, ArchElement, ArchRelationship, Language, TechChoice } from '@srs-tool/schemas';

const { projects, requirements, archModels, techRecommendations, diagrams, runs } = schema;

/**
 * ArchProcessor
 *
 * Synthesizes the architecture model asynchronously from:
 * 1. Reference architecture template by target platforms (`web`, `mobile`, `iot`)
 * 2. ASR Tactics catalog (`tactics-catalog.yaml`)
 * 3. Scored Technology Catalog (`tech-catalog.yaml`) -> `tech_recommendations`
 * 4. Regenerates `model`-mode diagrams (`context`, `container`) while preserving `detached` diagrams.
 *
 * Uses 0 LLM tokens.
 */
export class ArchProcessor {
  constructor(private readonly db?: DatabaseInstance) {}

  async process(job: Job): Promise<void> {
    const { projectId, runId } = job.data as { projectId: string; runId?: string };
    if (!this.db) throw new Error('ArchProcessor requires DATABASE_URL');
    const db = this.db;

    await job.updateProgress(10);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const reqs = await db
      .select()
      .from(requirements)
      .where(and(eq(requirements.projectId, projectId), ne(requirements.status, 'rejected')));

    const lang = (project.outputLanguage as Language) ?? 'vi';
    const platforms = project.platforms ?? ['web'];
    const allReqCodes = reqs.map((r) => r.code);
    const asrCodes = reqs.filter((r) => r.isAsr).map((r) => r.code);

    const elements: ArchElement[] = [
      {
        id: 'target_system',
        kind: 'system',
        name: project.name,
        description: lang === 'vi' ? 'Hệ thống phần mềm mục tiêu' : 'Target software system',
        requirement_ids: allReqCodes.slice(0, 10),
      },
      {
        id: 'user',
        kind: 'person',
        name: lang === 'vi' ? 'Người dùng' : 'End User',
        description: lang === 'vi' ? 'Tác nhân sử dụng hệ thống' : 'Primary system actor',
        requirement_ids: [],
      },
    ];

    const relationships: ArchRelationship[] = [];
    const addEl = (el: ArchElement) => {
      if (!elements.some((e) => e.id === el.id)) elements.push(el);
    };
    const addRel = (rel: ArchRelationship) => {
      if (!relationships.some((r) => r.source_id === rel.source_id && r.target_id === rel.target_id && r.label === rel.label)) {
        relationships.push(rel);
      }
    };

    const techCatalog = loadTechCatalog();
    const pickTech = (layer: string) =>
      techCatalog.entries.find((e) => e.layer === layer && e.platforms.some((p) => platforms.includes(p))) ??
      techCatalog.entries.find((e) => e.layer === layer);

    if (platforms.includes('web')) {
      const fe = pickTech('frontend');
      addEl({
        id: 'web_app',
        kind: 'container',
        name: 'Web Application',
        technology: fe?.name ?? 'React + Vite',
        platform: 'web',
        requirement_ids: reqs.filter((r) => r.platforms.includes('web')).map((r) => r.code),
      });
      addRel({ id: 'rel_user_web', source_id: 'user', target_id: 'web_app', label: 'HTTPS', protocol: 'HTTPS', requirement_ids: [] });
    }

    if (platforms.includes('mobile')) {
      const mob = pickTech('mobile');
      addEl({
        id: 'mobile_app',
        kind: 'container',
        name: 'Mobile App',
        technology: mob?.name ?? 'React Native (Expo)',
        platform: 'mobile',
        requirement_ids: reqs.filter((r) => r.platforms.includes('mobile')).map((r) => r.code),
      });
      addRel({ id: 'rel_user_mob', source_id: 'user', target_id: 'mobile_app', label: 'App UI', protocol: 'HTTPS', requirement_ids: [] });
    }

    const be = pickTech('backend');
    const dbChoice = pickTech('database');
    addEl({
      id: 'api_server',
      kind: 'container',
      name: 'API Server',
      technology: be?.name ?? 'NestJS',
      platform: 'shared',
      requirement_ids: allReqCodes.slice(0, 8),
    });
    addEl({
      id: 'database',
      kind: 'datastore',
      name: 'Primary Database',
      technology: dbChoice?.name ?? 'PostgreSQL',
      platform: 'shared',
      requirement_ids: asrCodes,
    });
    addRel({ id: 'rel_api_db', source_id: 'api_server', target_id: 'database', label: 'SQL / TCP', protocol: 'PostgreSQL', requirement_ids: [] });
    if (elements.some((e) => e.id === 'web_app')) {
      addRel({ id: 'rel_web_api', source_id: 'web_app', target_id: 'api_server', label: 'REST / SSE', protocol: 'HTTPS', requirement_ids: [] });
    }
    if (elements.some((e) => e.id === 'mobile_app')) {
      addRel({ id: 'rel_mob_api', source_id: 'mobile_app', target_id: 'api_server', label: 'REST / JSON', protocol: 'HTTPS', requirement_ids: [] });
    }

    if (platforms.includes('iot')) {
      const broker = pickTech('broker');
      addEl({
        id: 'iot_device',
        kind: 'device',
        name: lang === 'vi' ? 'Thiết bị IoT / Cảm biến' : 'IoT Sensor / Device',
        technology: 'Embedded / MQTT',
        platform: 'iot',
        requirement_ids: reqs.filter((r) => r.platforms.includes('iot')).map((r) => r.code),
      });
      addEl({
        id: 'mqtt_broker',
        kind: 'container',
        name: 'MQTT Broker',
        technology: broker?.name ?? 'EMQX',
        platform: 'iot',
        requirement_ids: reqs.filter((r) => r.platforms.includes('iot')).map((r) => r.code),
      });
      addRel({ id: 'rel_dev_broker', source_id: 'iot_device', target_id: 'mqtt_broker', label: 'Telemetry', protocol: 'MQTT/TLS', requirement_ids: [] });
      addRel({ id: 'rel_broker_api', source_id: 'mqtt_broker', target_id: 'api_server', label: 'Forward events', protocol: 'MQTT/TCP', requirement_ids: [] });
    }

    await job.updateProgress(50);

    // Apply ASR tactics from tactics-catalog.yaml
    const corpus = reqs.map((r) => `${r.statement} ${r.statementOriginal}`).join('\n');
    const tactics = loadTacticsCatalog().tactics;
    for (const t of tactics) {
      if (t.when.platform && !platforms.includes(t.when.platform)) continue;
      const matched = (t.when.keywords ?? []).some((kw) => new RegExp(kw, 'i').test(corpus));
      if (!matched) continue;
      for (const addItem of t.add?.elements ?? []) {
        const elId = addItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        addEl({
          id: elId,
          kind: addItem.kind,
          name: addItem.name,
          technology: addItem.technology,
          description: addItem.description,
          requirement_ids: asrCodes,
        });
        addRel({ id: `rel_api_${elId}`, source_id: 'api_server', target_id: elId, label: 'uses', requirement_ids: asrCodes });
      }
    }

    const techChoices: TechChoice[] = [];
    for (const layer of ['frontend', 'mobile', 'backend', 'database', 'cache', 'queue', 'broker', 'storage']) {
      const chosen = pickTech(layer);
      if (!chosen) continue;
      techChoices.push({
        layer,
        choice: chosen.name,
        alternatives: chosen.alternatives,
        rationale: typeof chosen.tradeoffs === 'string' ? chosen.tradeoffs.trim() : chosen.name,
        requirement_ids: asrCodes,
      });
    }

    const existingModels = await db.select().from(archModels).where(eq(archModels.projectId, projectId));
    const nextVersion = existingModels.length > 0 ? Math.max(...existingModels.map((m) => m.version)) + 1 : 1;
    const modelId = existingModels[0]?.id ?? crypto.randomUUID();
    const now = new Date();

    const body = {
      elements,
      relationships,
      views: [
        { id: 'view_context', type: 'context' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
        { id: 'view_container', type: 'container' as const, include_ids: elements.map((e) => e.id), mode: 'model' as const },
      ],
      tech_choices: techChoices,
    };

    if (existingModels[0]) {
      await db.update(archModels).set({ version: nextVersion, language: lang, body, updatedAt: now }).where(eq(archModels.id, modelId));
      await db.delete(techRecommendations).where(eq(techRecommendations.modelId, modelId));
    } else {
      await db.insert(archModels).values({ id: modelId, projectId, version: nextVersion, language: lang, body });
    }

    if (techChoices.length > 0) {
      await db.insert(techRecommendations).values(
        techChoices.map((tc) => ({
          modelId,
          layer: tc.layer,
          choice: tc.choice,
          alternatives: tc.alternatives,
          rationale: tc.rationale,
        })),
      );
    }

    const fullModel: ArchitectureModel = {
      id: modelId,
      project_id: projectId,
      version: nextVersion,
      language: lang,
      ...body,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    // Sync 'model'-mode diagrams while leaving 'detached' diagrams untouched
    for (const viewType of ['context', 'container'] as const) {
      const puml = generateDiagram(fullModel, viewType);
      const [existingDiag] = await db
        .select()
        .from(diagrams)
        .where(and(eq(diagrams.modelId, modelId), eq(diagrams.type, viewType)))
        .limit(1);

      if (!existingDiag) {
        await db.insert(diagrams).values({ modelId, type: viewType, mode: 'model', puml });
      } else if (existingDiag.mode === 'model') {
        await db.update(diagrams).set({ puml, updatedAt: now }).where(eq(diagrams.id, existingDiag.id));
      }
    }

    if (runId) {
      await db.update(runs).set({ status: 'succeeded', progress: 100, updatedAt: now }).where(eq(runs.id, runId));
    }
    await job.updateProgress(100);
  }
}
