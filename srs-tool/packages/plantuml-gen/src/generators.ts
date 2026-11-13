import type { ArchitectureModel, ArchElement, ViewType } from '@srs-tool/schemas';

/**
 * PlantUML Generator
 *
 * Pure TypeScript functions — 0 LLM tokens, air-gapped PlantUML stdlib compatible.
 * Uses built-in `<C4/C4_*>` includes bundled inside official PlantUML Server JARs
 * so rendering succeeds inside `internal: true` Docker sandboxes (NFR-SEC-004).
 */

export interface SafePumlValidationResult {
  valid: boolean;
  reason?: string;
  line?: number;
}

/** Sanitize element IDs into valid PlantUML identifiers (letters, digits, underscores). */
export function sanitizeId(id: string): string {
  const cleaned = id.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return 'el_unnamed';
  return /^[0-9]/.test(cleaned) ? `el_${cleaned}` : cleaned;
}

/** Escape PlantUML special characters in labels/names. */
function escape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\r?\n/g, '\\n');
}

/** Always wrap labels in double quotes for predictable C4 macro argument parsing. */
function label(text: string): string {
  return `"${escape(text)}"`;
}

/**
 * Validate user-edited PlantUML before sending to the renderer (NFR-SEC-004).
 * Blocks remote URLs, filesystem reads, environment variable leaks, and imports,
 * while permitting built-in `<C4/...>` or `<tupadr3/...>` stdlib includes.
 */
export function validateSafePuml(puml: string): SafePumlValidationResult {
  if (!puml || !puml.trim()) {
    return { valid: false, reason: 'PlantUML source is empty', line: 1 };
  }

  const lines = puml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    const lineNo = i + 1;

    if (/^!(includeurl|includesub|import|log)\b/i.test(trimmed)) {
      return {
        valid: false,
        reason: `Disallowed PlantUML directive on line ${lineNo}: external/file directives are blocked in sandbox`,
        line: lineNo,
      };
    }

    if (/^!include\b/i.test(trimmed)) {
      const rest = trimmed.replace(/^!include(?:_many|_once)?\s+/i, '').trim();
      const isStdlib = /^<[a-zA-Z0-9_/-]+(?:\.puml)?>$/.test(rest);
      if (!isStdlib) {
        return {
          valid: false,
          reason: `Unsafe !include on line ${lineNo}: only built-in stdlib includes like <C4/C4_Container> are permitted`,
          line: lineNo,
        };
      }
    }

    if (/%(getenv|filename|dirpath|file_exists)\b/i.test(trimmed)) {
      return {
        valid: false,
        reason: `Disallowed PlantUML preprocessor function on line ${lineNo}`,
        line: lineNo,
      };
    }
  }

  return { valid: true };
}

// C4 Context Diagram

export function generateContextDiagram(model: ArchitectureModel): string {
  const systems = model.elements.filter((e: ArchElement) => e.kind === 'system');
  const mainSystem: ArchElement = systems[0] ?? {
    id: 'target_system',
    kind: 'system',
    name: model.language === 'en' ? 'Target System' : 'Hệ thống mục tiêu',
    description:
      model.language === 'en'
        ? 'Core software system synthesized from SRS'
        : 'Hệ thống phần mềm trung tâm tổng hợp từ SRS',
    requirement_ids: [],
  };
  const mainSysAlias = sanitizeId(mainSystem.id);

  const lines: string[] = [
    '@startuml',
    '!include <C4/C4_Context>',
    '',
    `title System Context: ${escape(mainSystem.name)}`,
    '',
  ];

  // Map raw element ID -> Context-level alias
  const contextAliasByRawId = new Map<string, string>();
  const declaredAliases = new Set<string>();

  contextAliasByRawId.set(mainSystem.id, mainSysAlias);

  for (const el of model.elements) {
    const alias = sanitizeId(el.id);
    if (el.kind === 'person') {
      lines.push(`Person(${alias}, ${label(el.name)}, ${label(el.description ?? '')})`);
      contextAliasByRawId.set(el.id, alias);
      declaredAliases.add(alias);
    } else if (el.id === mainSystem.id) {
      lines.push(`System(${mainSysAlias}, ${label(mainSystem.name)}, ${label(mainSystem.description ?? '')})`);
      declaredAliases.add(mainSysAlias);
    } else if (el.kind === 'system') {
      lines.push(`System_Ext(${alias}, ${label(el.name)}, ${label(el.description ?? '')})`);
      contextAliasByRawId.set(el.id, alias);
      declaredAliases.add(alias);
    } else if (el.kind === 'device') {
      lines.push(`System_Ext(${alias}, ${label(el.name)}, ${label(el.description ?? el.technology ?? 'IoT / Edge Device')})`);
      contextAliasByRawId.set(el.id, alias);
      declaredAliases.add(alias);
    } else {
      // Internal container / datastore / component rolls up to the central target system in Context view
      contextAliasByRawId.set(el.id, mainSysAlias);
    }
  }

  if (!declaredAliases.has(mainSysAlias)) {
    lines.push(`System(${mainSysAlias}, ${label(mainSystem.name)}, ${label(mainSystem.description ?? '')})`);
    declaredAliases.add(mainSysAlias);
  }

  lines.push('');
  const emittedRels = new Set<string>();
  for (const rel of model.relationships) {
    const src = contextAliasByRawId.get(rel.source_id);
    const tgt = contextAliasByRawId.get(rel.target_id);
    if (!src || !tgt || src === tgt) continue;
    if (!declaredAliases.has(src) || !declaredAliases.has(tgt)) continue;
    const dedupeKey = `${src}->${tgt}:${rel.label ?? ''}`;
    if (emittedRels.has(dedupeKey)) continue;
    emittedRels.add(dedupeKey);
    const proto = rel.protocol ? `, ${label(rel.protocol)}` : '';
    lines.push(`Rel(${src}, ${tgt}, ${label(rel.label ?? 'uses')}${proto})`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// C4 Container Diagram

export function generateContainerDiagram(model: ArchitectureModel): string {
  const systems = model.elements.filter((e: ArchElement) => e.kind === 'system');
  const mainSystem = systems[0];
  const externalSystems = systems.slice(1);
  const persons = model.elements.filter((e: ArchElement) => e.kind === 'person');
  const devices = model.elements.filter((e: ArchElement) => e.kind === 'device');
  const containers = model.elements.filter((e: ArchElement) => e.kind === 'container');
  const datastores = model.elements.filter((e: ArchElement) => e.kind === 'datastore');
  const components = model.elements.filter((e: ArchElement) => e.kind === 'component');

  const boundaryId = sanitizeId((mainSystem?.id ?? 'target_system') + '_boundary');
  const boundaryName =
    mainSystem?.name ?? (model.language === 'en' ? 'Target System' : 'Hệ thống mục tiêu');

  const lines: string[] = [
    '@startuml',
    '!include <C4/C4_Container>',
    '',
    `title Container View: ${escape(boundaryName)}`,
    '',
  ];

  const aliasByRawId = new Map<string, string>();
  const declaredAliases = new Set<string>();

  for (const el of persons) {
    const alias = sanitizeId(el.id);
    lines.push(`Person(${alias}, ${label(el.name)}, ${label(el.description ?? '')})`);
    aliasByRawId.set(el.id, alias);
    declaredAliases.add(alias);
  }

  for (const dev of devices) {
    const alias = sanitizeId(dev.id);
    const tech = dev.technology || 'IoT / Edge Device';
    lines.push(`Container(${alias}, ${label(dev.name)}, ${label(tech)}, ${label(dev.description ?? '')})`);
    aliasByRawId.set(dev.id, alias);
    declaredAliases.add(alias);
  }

  for (const ext of externalSystems) {
    const alias = sanitizeId(ext.id);
    lines.push(`System_Ext(${alias}, ${label(ext.name)}, ${label(ext.description ?? '')})`);
    aliasByRawId.set(ext.id, alias);
    declaredAliases.add(alias);
  }

  if (containers.length > 0 || datastores.length > 0) {
    lines.push(`System_Boundary(${boundaryId}, ${label(boundaryName)}) {`);
    for (const c of containers) {
      const alias = sanitizeId(c.id);
      lines.push(
        `  Container(${alias}, ${label(c.name)}, ${label(c.technology ?? 'Service')}, ${label(c.description ?? '')})`,
      );
      aliasByRawId.set(c.id, alias);
      declaredAliases.add(alias);
    }
    for (const ds of datastores) {
      const alias = sanitizeId(ds.id);
      lines.push(
        `  ContainerDb(${alias}, ${label(ds.name)}, ${label(ds.technology ?? 'Database')}, ${label(ds.description ?? '')})`,
      );
      aliasByRawId.set(ds.id, alias);
      declaredAliases.add(alias);
    }
    lines.push('}');
  } else if (mainSystem) {
    const alias = sanitizeId(mainSystem.id);
    lines.push(`System(${alias}, ${label(mainSystem.name)}, ${label(mainSystem.description ?? '')})`);
    aliasByRawId.set(mainSystem.id, alias);
    declaredAliases.add(alias);
  }

  // Roll up component-level relationships to their parent container if present
  for (const comp of components) {
    if (comp.parent_id && aliasByRawId.has(comp.parent_id)) {
      aliasByRawId.set(comp.id, aliasByRawId.get(comp.parent_id)!);
    }
  }

  lines.push('');
  const emittedRels = new Set<string>();
  for (const rel of model.relationships) {
    const src = aliasByRawId.get(rel.source_id);
    const tgt = aliasByRawId.get(rel.target_id);
    if (!src || !tgt || src === tgt) continue;
    if (!declaredAliases.has(src) || !declaredAliases.has(tgt)) continue;
    const key = `${src}->${tgt}:${rel.label ?? ''}:${rel.protocol ?? ''}`;
    if (emittedRels.has(key)) continue;
    emittedRels.add(key);
    const proto = rel.protocol ? `, ${label(rel.protocol)}` : '';
    lines.push(`Rel(${src}, ${tgt}, ${label(rel.label ?? 'uses')}${proto})`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Sequence Diagram

export function generateSequenceDiagram(
  model: ArchitectureModel,
  sequenceFlow?: { title: string; steps: Array<{ from: string; to: string; label: string; async?: boolean }> },
): string {
  const flow = sequenceFlow ?? {
    title: model.language === 'en' ? 'Primary Interaction Sequence' : 'Luồng tương tác chính',
    steps: model.relationships.map((r) => ({
      from: r.source_id,
      to: r.target_id,
      label: r.label ?? r.protocol ?? 'request',
      async: r.async,
    })),
  };

  const lines: string[] = ['@startuml', `title ${escape(flow.title)}`, ''];

  const participantIds = new Set(flow.steps.flatMap((s) => [s.from, s.to]));
  const declared = new Map<string, string>();
  for (const id of participantIds) {
    const alias = sanitizeId(id);
    const el = model.elements.find((e: ArchElement) => e.id === id);
    const displayName = el?.name ?? id;
    lines.push(`participant ${label(displayName)} as ${alias}`);
    declared.set(id, alias);
  }

  lines.push('');

  for (const step of flow.steps) {
    const fromAlias = declared.get(step.from);
    const toAlias = declared.get(step.to);
    if (!fromAlias || !toAlias) continue;
    const arrow = step.async ? '->>' : '->';
    lines.push(`${fromAlias} ${arrow} ${toAlias} : ${escape(step.label)}`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Component Diagram

export function generateComponentDiagram(
  model: ArchitectureModel,
  containerId?: string,
): string {
  const targetContainer =
    (containerId
      ? model.elements.find((e: ArchElement) => e.id === containerId)
      : undefined) ?? model.elements.find((e: ArchElement) => e.kind === 'container');

  if (!targetContainer) {
    return `@startuml\n!include <C4/C4_Component>\ntitle Component View\n@enduml`;
  }

  const lines: string[] = [
    '@startuml',
    '!include <C4/C4_Component>',
    '',
    `title Component View: ${escape(targetContainer.name)}`,
    '',
  ];

  const components = model.elements.filter(
    (e: ArchElement) => e.kind === 'component' && (!e.parent_id || e.parent_id === targetContainer.id),
  );
  const declared = new Map<string, string>();

  lines.push(`Container_Boundary(${sanitizeId(targetContainer.id)}_b, ${label(targetContainer.name)}) {`);
  if (components.length === 0) {
    const defaultAlias = `${sanitizeId(targetContainer.id)}_core`;
    lines.push(
      `  Component(${defaultAlias}, ${label(targetContainer.name + ' Core')}, ${label(targetContainer.technology ?? 'Module')}, ${label(targetContainer.description ?? '')})`,
    );
    declared.set(targetContainer.id, defaultAlias);
  } else {
    for (const c of components) {
      const alias = sanitizeId(c.id);
      lines.push(
        `  Component(${alias}, ${label(c.name)}, ${label(c.technology ?? '')}, ${label(c.description ?? '')})`,
      );
      declared.set(c.id, alias);
    }
  }
  lines.push('}');

  // Declare external neighbors referenced by component relationships
  for (const rel of model.relationships) {
    const touchesScope = declared.has(rel.source_id) || declared.has(rel.target_id);
    if (!touchesScope) continue;
    for (const endpointId of [rel.source_id, rel.target_id]) {
      if (declared.has(endpointId)) continue;
      const neighbor = model.elements.find((e) => e.id === endpointId);
      if (!neighbor) continue;
      const alias = sanitizeId(neighbor.id);
      if (neighbor.kind === 'datastore') {
        lines.push(
          `ContainerDb(${alias}, ${label(neighbor.name)}, ${label(neighbor.technology ?? 'DB')}, ${label(neighbor.description ?? '')})`,
        );
      } else {
        lines.push(
          `Container_Ext(${alias}, ${label(neighbor.name)}, ${label(neighbor.technology ?? '')}, ${label(neighbor.description ?? '')})`,
        );
      }
      declared.set(neighbor.id, alias);
    }
  }

  lines.push('');
  for (const rel of model.relationships) {
    const src = declared.get(rel.source_id);
    const tgt = declared.get(rel.target_id);
    if (!src || !tgt || src === tgt) continue;
    lines.push(`Rel(${src}, ${tgt}, ${label(rel.label ?? 'uses')})`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// ER Diagram

export function generateERDiagram(
  entities: Array<{ name: string; attributes: Array<{ name: string; type: string; isPK?: boolean; isFK?: boolean }> }>,
  relationships: Array<{ from: string; to: string; label: string; cardinality: string }>,
): string {
  const lines: string[] = ['@startuml', 'hide circle', 'skinparam linetype ortho', ''];

  for (const entity of entities) {
    lines.push(`entity "${escape(entity.name)}" {`);
    for (const attr of entity.attributes) {
      const pk = attr.isPK ? '* ' : '  ';
      const fk = attr.isFK ? ' <<FK>>' : '';
      lines.push(`  ${pk}${attr.name} : ${attr.type}${fk}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const rel of relationships) {
    lines.push(`"${escape(rel.from)}" ${rel.cardinality} "${escape(rel.to)}" : ${escape(rel.label)}`);
  }

  lines.push('');
  lines.push('@enduml');
  return lines.join('\n');
}

// Dispatcher

/** Generate PlantUML for any view type from the architecture model. */
export function generateDiagram(
  model: ArchitectureModel,
  viewType: ViewType,
  options?: { containerId?: string; sequenceFlowId?: string },
): string {
  switch (viewType) {
    case 'context':
      return generateContextDiagram(model);
    case 'container':
      return generateContainerDiagram(model);
    case 'component':
      return generateComponentDiagram(model, options?.containerId);
    case 'sequence':
      return generateSequenceDiagram(model);
    case 'er': {
      const datastores = model.elements.filter((e) => e.kind === 'datastore');
      const entities = datastores.map((ds) => ({
        name: ds.name,
        attributes: [
          { name: 'id', type: 'UUID', isPK: true },
          { name: 'created_at', type: 'TIMESTAMPTZ' },
        ],
      }));
      return generateERDiagram(entities, []);
    }
    default:
      return generateContainerDiagram(model);
  }
}
