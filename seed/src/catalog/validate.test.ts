import { describe, expect, it } from 'vitest';

import {
  ALL_SCENARIOS,
  BULK_ACTIONS_SCENARIO,
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SIZE_FILTER_SCENARIO,
} from './index.js';
import type { SeedScenario } from './types.js';
import { validateCatalog, validateScenario } from './validate.js';

/** e2e-only fixtures materialized directly via `materializeFixture` (absent from
 * `ALL_SCENARIOS`, so not demo content) — still validated so a broken ref/media
 * payload fails offline, exactly like a registered scenario. */
const E2E_ONLY_FIXTURES: SeedScenario[] = [
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SIZE_FILTER_SCENARIO,
  BULK_ACTIONS_SCENARIO,
];

describe('seed catalog integrity', () => {
  it('the whole registered catalog is internally consistent', () => {
    expect(validateCatalog(ALL_SCENARIOS)).toEqual([]);
  });

  it.each(ALL_SCENARIOS.map((s) => [s.id, s] as const))(
    'scenario "%s" validates',
    (_id, scenario) => {
      expect(validateScenario(scenario)).toEqual([]);
    }
  );

  it('every registered scenario opts into at least one preset', () => {
    for (const s of ALL_SCENARIOS) {
      expect(s.presets.length).toBeGreaterThan(0);
    }
  });

  it.each(E2E_ONLY_FIXTURES.map((s) => [s.id, s] as const))(
    'e2e-only fixture "%s" validates',
    (_id, scenario) => {
      expect(validateScenario(scenario)).toEqual([]);
    }
  );

  it('catches the common authoring mistakes (negative)', () => {
    const bad = {
      id: 'bad',
      title: 'Bad',
      summary: '',
      presets: [],
      tree: [
        {
          ref: 'a',
          kind: 'folder',
          title: 'A',
          owner: 'ghost',
          children: [{ ref: 'a', kind: 'text', title: 'dup ref' }],
        },
      ],
      contains: [{ folder: 'a', child: 'missing', by: 'ghost-filer' }],
    } as unknown as SeedScenario;

    const errors = validateScenario(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('empty summary'))).toBe(true);
    expect(errors.some((e) => e.includes('non-empty array'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown actor "ghost"'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate node ref "a"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown node ref "missing"'))).toBe(
      true
    );
    // The ADR-0023 `contains.by` cross-owner filer must resolve to a known actor.
    expect(
      errors.some(
        (e) =>
          e.includes('contains.by') && e.includes('unknown actor "ghost-filer"')
      )
    ).toBe(true);
  });
});
