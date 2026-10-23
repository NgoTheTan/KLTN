/**
 * Prompt Registry
 * Centralizes all prompts used in the system with versioning.
 * Prompts are loaded from YAML files in packages/knowledge/prompts/
 * and registered here with a stable ID and version.
 */

export interface PromptTemplate {
  id: string;
  version: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string; // Handlebars-style {{variable}} placeholders
}

export type PromptId =
  | 'extract-candidates'    // S2: Extract requirement candidates
  | 'classify-requirements' // S3: Classify and tag
  | 'detect-issues'         // S4: Detect ambiguity/conflicts
  | 'normalize-ears'        // S6: Normalize to EARS pattern
  | 'merge-duplicates'      // S7: Confirm merge candidates
  | 'coverage-check'        // S8: Verify coverage
  | 'arch-enrich'           // Architecture model enrichment (optional)
  | 'agent-freeform';       // Agent free-form conversation

/** Registry maps promptId → PromptTemplate */
export class PromptRegistry {
  private registry = new Map<string, PromptTemplate>();

  register(prompt: PromptTemplate): void {
    this.registry.set(prompt.id, prompt);
  }

  get(id: PromptId): PromptTemplate {
    const p = this.registry.get(id);
    if (!p) throw new Error(`Prompt not found: ${id}`);
    return p;
  }

  /** Fill placeholders: replaceAll('{{key}}', value) */
  fill(id: PromptId, vars: Record<string, string>): string {
    const p = this.get(id);
    let tpl = p.userPromptTemplate;
    for (const [key, val] of Object.entries(vars)) {
      tpl = tpl.replaceAll(`{{${key}}}`, val);
    }
    return tpl;
  }
}

export const promptRegistry = new PromptRegistry();
