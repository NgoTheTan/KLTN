import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPlatformProfile,
  loadCombinedChecklist,
  loadPlatformDefaults,
  loadTechCatalog,
  loadTacticsCatalog,
} from '../dist/index.js';

test('loads all 4 platform profiles (web, mobile, iot, shared) with bilingual fields', () => {
  for (const p of ['web', 'mobile', 'iot', 'shared']) {
    const prof = loadPlatformProfile(p);
    assert.equal(prof.platform, p);
    assert.ok(prof.checklist.length >= 4, `${p} should have checklist items`);
    for (const item of prof.checklist) {
      assert.ok(item.id);
      assert.ok(item.topic.vi && item.topic.en);
      assert.ok(item.question.vi && item.question.en);
      assert.ok(Array.isArray(item.keywords.vi) && Array.isArray(item.keywords.en));
    }
  }
});

test('loadCombinedChecklist merges target platform and shared items without duplicates', () => {
  const items = loadCombinedChecklist(['web']);
  const ids = items.map((i) => i.id);
  assert.ok(ids.some((id) => id.startsWith('web-')));
  assert.ok(ids.some((id) => id.startsWith('shared-')));
  assert.equal(new Set(ids).size, ids.length);
});

test('loadPlatformDefaults merges shared and platform default_values', () => {
  const defaults = loadPlatformDefaults(['web', 'iot']);
  assert.ok(typeof defaults.response_time_p95_ms === 'number');
  assert.ok(typeof defaults.backup_rpo_hours === 'number');
});

test('loadTechCatalog and loadTacticsCatalog parse entries, scores, alternatives, and tactics', () => {
  const tech = loadTechCatalog();
  assert.ok(tech.entries.length >= 10);
  assert.equal(tech.entries.length, tech.technologies.length);
  assert.ok(tech.updated_at !== 'unknown');
  const pg = tech.entries.find((e) => e.id === 'postgresql');
  assert.ok(pg);
  assert.ok(pg.scores.reliability >= 4);
  assert.ok(pg.alternatives.length >= 1);

  const tactics = loadTacticsCatalog();
  assert.ok(tactics.tactics.length >= 7);
  assert.ok(tactics.tactics.some((t) => t.id === 'perf-cache'));
  assert.ok(tactics.tactics.some((t) => t.id === 'iot-broker'));
});
