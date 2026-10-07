import { describe, expect, it } from 'vitest';
import { liveScenario } from './index';
import { InMemoryDatabase } from './memory';
import { boardDate } from '../dispatch/board-date';
import { EASTWIND_DATE, singaporeToday } from '../shared/config/demo';

describe('liveScenario', () => {
  it('keeps tests on the fixed Eastwind fixture', () => {
    expect(liveScenario({ NODE_ENV: 'test' })().date).toBe(EASTWIND_DATE);
    expect(liveScenario({ DEMO_SCENARIO: 'eastwind' })().technicians).toHaveLength(6);
  });

  it('runs the finals board dated today in Singapore by default', () => {
    const data = liveScenario({})();
    expect(data.technicians).toHaveLength(15);
    expect(data.date).toBe(singaporeToday());
  });

  it('pins the day with BOARD_DATE and ignores a malformed one', () => {
    expect(liveScenario({ BOARD_DATE: '2026-11-03' })().date).toBe('2026-11-03');
    expect(liveScenario({ BOARD_DATE: 'tuesday' })().date).toBe(singaporeToday());
  });

  it('re-dates the board on reset, because the scenario is a builder', async () => {
    let day = '2026-11-03';
    const db = new InMemoryDatabase({ scenario: () => liveScenario({ BOARD_DATE: day })() });
    expect(await boardDate(db)).toBe('2026-11-03');
    day = '2026-11-04';
    await db.reset();
    expect(await boardDate(db)).toBe('2026-11-04');
  });
});

describe('singaporeToday', () => {
  it('is the Singapore calendar day, not UTC', () => {
    // 17:30 UTC on 5 Oct is 01:30 on 6 Oct in Singapore.
    expect(singaporeToday(new Date('2026-10-05T17:30:00Z'))).toBe('2026-10-06');
    expect(singaporeToday(new Date('2026-10-05T15:59:00Z'))).toBe('2026-10-05');
  });
});
