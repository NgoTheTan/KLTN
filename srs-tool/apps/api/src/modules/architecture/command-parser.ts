import { PatchOperation } from '@srs-tool/schemas';

export interface CommandParseResult {
  matched: boolean;
  commandType?: string;
  operations: PatchOperation[];
  explanation: string;
}

/**
 * CommandParser — parses fixed syntax commands deterministically without LLM.
 * Reduces token cost and provides 100% predictable model patch generation.
 */
export class CommandParser {
  static parse(command: string): CommandParseResult {
    const trimmed = command.trim();

    // 1. rename element <id> to <newName> (Vietnamese: đổi tên <id> thành <newName>)
    const renameMatch =
      trimmed.match(/^(?:rename\s+element|đổi\s+tên\s+(?:thành\s+phần\s+)?)\s*["']?([a-zA-Z0-9_-]+)["']?\s+(?:to|thành)\s+["']?([^"']+)["']?$/i);
    if (renameMatch) {
      const [, elementId, newName] = renameMatch;
      return {
        matched: true,
        commandType: 'rename',
        operations: [
          {
            op: 'update_element',
            element_id: elementId,
            changes: { name: newName.trim() },
          },
        ],
        explanation: `Renamed element '${elementId}' to '${newName.trim()}'`,
      };
    }

    // 2. remove element <id> (Vietnamese: xoá thành phần <id>)
    const removeMatch =
      trimmed.match(/^(?:remove\s+element|delete\s+element|xoá\s+(?:thành\s+phần\s+)?)\s*["']?([a-zA-Z0-9_-]+)["']?$/i);
    if (removeMatch) {
      const [, elementId] = removeMatch;
      return {
        matched: true,
        commandType: 'remove_element',
        operations: [
          {
            op: 'remove_element',
            element_id: elementId,
          },
        ],
        explanation: `Removed element '${elementId}'`,
      };
    }

    // 3. change tech of <id> to <tech> (Vietnamese: đổi công nghệ của <id> sang <tech>)
    const changeTechMatch =
      trimmed.match(/^(?:change\s+tech\s+of|set\s+technology\s+of|đổi\s+công\s+nghệ\s+(?:của\s+)?)\s*["']?([a-zA-Z0-9_-]+)["']?\s+(?:to|sang|thành)\s+["']?([^"']+)["']?$/i);
    if (changeTechMatch) {
      const [, elementId, tech] = changeTechMatch;
      return {
        matched: true,
        commandType: 'change_tech',
        operations: [
          {
            op: 'update_element',
            element_id: elementId,
            changes: { technology: tech.trim() },
          },
        ],
        explanation: `Updated technology of '${elementId}' to '${tech.trim()}'`,
      };
    }

    // 4. connect <sourceId> to <targetId> [label <label>] [protocol <protocol>]
    // (Vietnamese: nối <sourceId> tới <targetId> [nhãn <label>])
    const connectMatch =
      trimmed.match(/^(?:connect|nối)\s*["']?([a-zA-Z0-9_-]+)["']?\s+(?:to|với|tới)\s+["']?([a-zA-Z0-9_-]+)["']?(?:\s+(?:label|nhãn)\s+["']?([^"']+)["']?)?(?:\s+(?:protocol|giao\s+thức)\s+["']?([^"']+)["']?)?$/i);
    if (connectMatch) {
      const [, sourceId, targetId, label, protocol] = connectMatch;
      const relId = `rel_${sourceId}_${targetId}_${Date.now().toString(36).substring(4)}`;
      return {
        matched: true,
        commandType: 'connect',
        operations: [
          {
            op: 'add_relationship',
            relationship: {
              id: relId,
              source_id: sourceId,
              target_id: targetId,
              label: label?.trim() || 'connects to',
              protocol: protocol?.trim(),
              async: false,
              requirement_ids: [],
            },
          },
        ],
        explanation: `Connected '${sourceId}' to '${targetId}' (${label || 'default'})`,
      };
    }

    // 5. add element <kind> <name> [tech <tech>] [platform <platform>]
    // (Vietnamese: thêm thành phần <kind> <name>)
    const addElementMatch =
      trimmed.match(/^(?:add\s+element|thêm\s+(?:thành\s+phần\s+)?)\s*(person|system|container|component|device|datastore)\s+["']?([^"']+)["']?(?:\s+(?:tech|công\s+nghệ)\s+["']?([^"']+)["']?)?(?:\s+(?:platform|nền\s+tảng)\s+["']?([^"']+)["']?)?$/i);
    if (addElementMatch) {
      const [, kind, name, tech, platform] = addElementMatch;
      const id = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      const validPlatforms = ['web', 'mobile', 'iot', 'shared'] as const;
      const plat = validPlatforms.includes(platform?.toLowerCase() as any)
        ? (platform?.toLowerCase() as any)
        : undefined;

      return {
        matched: true,
        commandType: 'add_element',
        operations: [
          {
            op: 'add_element',
            element: {
              id,
              kind: kind.toLowerCase() as any,
              name: name.trim(),
              technology: tech?.trim(),
              platform: plat,
              requirement_ids: [],
            },
          },
        ],
        explanation: `Added ${kind} '${name.trim()}' with ID '${id}'`,
      };
    }

    return {
      matched: false,
      operations: [],
      explanation: 'Command not recognized as a fixed command. Forwarding to free-form agent loop.',
    };
  }
}
