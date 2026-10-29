import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Locate package root directory
function getKnowledgeRoot(): string {
  if (typeof __dirname !== 'undefined') {
    return path.resolve(__dirname, '..');
  }
  return path.resolve(process.cwd(), 'packages', 'knowledge');
}

const KNOWLEDGE_ROOT = getKnowledgeRoot();

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
  platform: 'web' | 'mobile' | 'iot' | 'shared';
  checklist: ChecklistItem[];
}

export interface TechItem {
  id: string;
  name: string;
  layer: string;
  platforms: string[];
  license: string;
  maturity: 'proven' | 'emerging' | 'niche';
  tags: string[];
  tradeoffs?: {
    pros?: string[];
    cons?: string[];
  };
}

export interface TechCatalog {
  version: string;
  last_updated: string;
  technologies: TechItem[];
}

export interface TacticItem {
  id: string;
  quality: string;
  name: string;
  description: string;
  when: Record<string, unknown>;
  add?: {
    elements?: any[];
    relationships?: any[];
  };
}

export interface TacticsCatalog {
  version: string;
  tactics: TacticItem[];
}

/**
 * Loads a platform profile YAML (web, mobile, iot).
 */
export function loadPlatformProfile(platform: 'web' | 'mobile' | 'iot'): PlatformProfile {
  const filePath = path.join(KNOWLEDGE_ROOT, 'profiles', `${platform}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as PlatformProfile;
}

/**
 * Loads and combines checklists for multiple platforms.
 */
export function loadCombinedChecklist(platforms: string[]): (ChecklistItem & { platform: string })[] {
  const results: (ChecklistItem & { platform: string })[] = [];
  const normalized = new Set(platforms);

  for (const p of ['web', 'mobile', 'iot'] as const) {
    if (normalized.has(p)) {
      try {
        const prof = loadPlatformProfile(p);
        for (const item of prof.checklist || []) {
          results.push({ ...item, platform: p });
        }
      } catch (err) {
        // Continue if profile missing
      }
    }
  }

  return results;
}

/**
 * Loads tech-catalog.yaml.
 */
export function loadTechCatalog(): TechCatalog {
  const filePath = path.join(KNOWLEDGE_ROOT, 'catalog', 'tech-catalog.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tech catalog not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as TechCatalog;
}

/**
 * Loads tactics-catalog.yaml.
 */
export function loadTacticsCatalog(): TacticsCatalog {
  const filePath = path.join(KNOWLEDGE_ROOT, 'tactics', 'tactics-catalog.yaml');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tactics catalog not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as TacticsCatalog;
}
