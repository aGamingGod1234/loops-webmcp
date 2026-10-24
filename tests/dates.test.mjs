import assert from 'node:assert/strict';
import test from 'node:test';
import { daysUntil, parseUntil } from '../src/dates.ts';

for (const timezone of ['America/Los_Angeles', 'Asia/Singapore', 'UTC']) {
  test(`date-only deadlines keep their calendar day in ${timezone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = timezone;
    try {
      const due = parseUntil('2026-10-25');
      assert.equal(due.getDate(), 25);
      assert.equal(due.getHours(), 9);
      assert.equal(daysUntil(due.toISOString(), new Date(2026, 9, 25, 12)), 0);
      assert.throws(() => parseUntil('2026-02-30'), /Invalid date/);
      assert.equal(parseUntil('2026-10-25T00:00:00Z').toISOString(), '2026-10-25T00:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}

test('relative dates accept spaces and reject invalid values', () => {
  const expected = new Date();
  expected.setDate(expected.getDate() + 3);
  expected.setHours(9, 0, 0, 0);
  assert.equal(parseUntil('3 d').toISOString(), expected.toISOString());
  assert.throws(() => parseUntil('not a date'), /Invalid date/);
});
