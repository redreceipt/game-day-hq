import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packet, relay } from '../kindle/relay.mjs';

test('Kindle packet escapes line and column separators and leaves missing points blank', () => {
  const data = packet({
    state: 'In progress', team: "Tomás\n| T's", teamScore: 0,
    opponent: 'Owls', opponentScore: null,
    roster: [{ bench: true, name: 'Bench' }, { slot: 'QB', name: 'Star|ter', actual: 0 }],
  }, 7, { now: new Date('2026-11-24T23:40:00Z') });
  assert.equal(data, "GDHQ1\nLIVE\nWeek 7 / In progress\nTomas T's\n0.00\nOwls\n--\nUpdated 11-24 23:40 UTC\nQB|Star ter|0.00\n");
});

test('demo relay labels sample data and exposes only the read-only score packet', async t => {
  const server = relay();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const result = await fetch(url + '/score');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(await result.text(), /^GDHQ1\nDEMO\nWeek 11/);
  assert.equal((await fetch(url + '/score', { method: 'POST' })).status, 404);
  assert.equal((await fetch(url + '/score?league=1')).status, 404);
});
