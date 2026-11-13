import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Locate package root directory reliably regardless of process.cwd()
function getKnowledgeRoot(): string {
  if (typeof __dirname !== 'undefined') {
    return path.resolve(__dirname, '..');
  }
  return path.resolve(process.cwd(), 'packages', 'knowledge');
}

const KNOWLEDGE_ROOT = getKnowledgeRoot();

export type KnowledgePlatform = 'web' | 'mobile' | 'iot' | 'shared';

export interface ChecklistItem {
  id: string;
  topic: { vi: string; en: string };
  keywords: { vi: string[]; en: string[] };
  quality: string;
  level: 'required' | 'recommended' | 'conditional';
  applies_when?: string | null;
  question: { vi: string; en: string };
}

export interface PlatformProfile {
  version: string;
  platform: KnowledgePlatform;
  checklist: ChecklistItem[];
  default_values?: Record<string, string | number | boolean>;
}

export interface TechItem {
  id: string;
  name: string;
  layer: string;
  version?: string;
  platforms: string[];
  license: string;
  maturity: 'high' | 'medium' | 'low' | 'proven' | 'emerging' | 'niche';
  learning_curve?: 'low' | 'medium' | 'high';
  tags: string[];
  scores: Record<string, number>;
  tradeoffs: string | { pros?: string[]; cons?: string[] };
  alternatives: string[];
}

export interface TechCatalog {
  version: string;
  updated_at: string;
  last_updated: string;
  entries: TechItem[];
  technologies: TechItem[];
}

export interface TacticElementSpec {
  id?: string;
  kind: 'person' | 'system' | 'container' | 'component' | 'device' | 'datastore';
  name: string;
  technology?: string;
  description?: string;
}

export interface TacticRelationshipSpec {
  source: string;
  target: string;
  label?: string;
  protocol?: string;
}

export interface TacticItem {
  id: string;
  when: {
    quality?: string;
    platform?: string;
    keywords?: string[];
  };
  add?: {
    elements?: TacticElementSpec[];
    relationships?: TacticRelationshipSpec[];
  };
  notes?: string;
  stack_tags?: string[];
  rationale: string;
}

export interface TacticsCatalog {
  version: string;
  tactics: TacticItem[];
}

const profileCache = new Map<KnowledgePlatform, PlatformProfile>();
let techCatalogCache: TechCatalog | null = null;
let tacticsCatalogCache: TacticsCatalog | null = null;

/**
 * Loads a platform profile YAML (web, mobile, iot, or shared).
 */
export function loadPlatformProfile(platform: KnowledgePlatform): PlatformProfile {
  const cached = profileCache.get(platform);
  if (cached) return cached;

  const filePath = path.join(KNOWLEDGE_ROOT, 'profiles', `${platform}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as PlatformProfile;
  profileCache.set(platform, parsed);
  return parsed;
}

/**
 * Loads and combines checklists for the selected platforms PLUS shared cross-cutting items.
 * Deduplicates by checklist item id.
 */
export function loadCombinedChecklist(
  platforms: string[],
): (ChecklistItem & { platform: KnowledgePlatform })[] {
  const results: (ChecklistItem & { platform: KnowledgePlatform })[] = [];
  const seenIds = new Set<string>();
  const requested = new Set<string>(platforms);
  requested.add('shared');

  for (const p of ['web', 'mobile', 'iot', 'shared'] as const) {
    if (!requested.has(p)) continue;
    try {
      const prof = loadPlatformProfile(p);
      for (const item of prof.checklist ?? []) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          results.push({ ...item, platform: p });
        }
      }
    } catch {
      // Ignore missing optional profile
    }
  }

  return results;
}

/**
 * Loads merged default_values across shared + selected target platforms (platform overrides shared).
 */
export function loadPlatformDefaults(platforms: string[]): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = {};
  const ordered: KnowledgePlatform[] = ['shared'];
  for (const p of ['web', 'mobile', 'iot'] as const) {
    if (platforms.includes(p)) ordered.push(p);
  }

  for (const p of ordered) {
    try {
      const prof = loadPlatformProfile(p);
      if (prof.default_values) {
        Object.assign(merged, prof.default_values);
      }
    } catch {
      // Ignore missing optional profile
    }
  }
  return merged;
}

/**
 * Loads catalog/tech-catalog.yaml and normalizes both `entries` and `technologies` aliases.
 */
export function loadTechCatalog(): TechCatalog {
  if (techCatalogCache) return techCatalogCache;

  const filePath = path.join(KNOWLEDGE_ROOT, 'catalog', 'tech-catalog.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tech catalog not found: ${filePath}`);
  }
  const raw = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
  const rawEntries: any[] = Array.isArray(raw['entries'])
    ? raw['entries']
    : Array.isArray(raw['technologies'])
      ? raw['technologies']
      : [];

  const entries: TechItem[] = rawEntries.map((e) => ({
    id: String(e.id),
    name: String(e.name),
    layer: String(e.layer),
    version: e.version ? String(e.version) : undefined,
    platforms: Array.isArray(e.platforms) ? e.platforms : [],
    license: String(e.license ?? 'unknown'),
    maturity: e.maturity ?? 'high',
    learning_curve: e.learning_curve,
    tags: Array.isArray(e.tags) ? e.tags : [],
    scores: typeof e.scores === 'object' && e.scores !== null ? e.scores : {},
    tradeoffs: e.tradeoffs ?? '',
    alternatives: Array.isArray(e.alternatives) ? e.alternatives : [],
  }));

  const updatedAt = String(raw['updated_at'] ?? raw['last_updated'] ?? 'unknown');
  techCatalogCache = {
    version: String(raw['version'] ?? '1.0.0'),
    updated_at: updatedAt,
    last_updated: updatedAt,
    entries,
    technologies: entries,
  };
  return techCatalogCache;
}

/**
 * Loads tactics/tactics-catalog.yaml.
 */
export function loadTacticsCatalog(): TacticsCatalog {
  if (tacticsCatalogCache) return tacticsCatalogCache;

  const filePath = path.join(KNOWLEDGE_ROOT, 'tactics', 'tactics-catalog.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tactics catalog not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  tacticsCatalogCache = yaml.load(content) as TacticsCatalog;
  return tacticsCatalogCache;
}
