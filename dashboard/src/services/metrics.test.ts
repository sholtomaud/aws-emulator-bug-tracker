import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot,
  loadSnapshot,
  minutesToMidnight,
  niceCeil,
  parseCsv,
  threatLevel,
  toPoints,
  velocity,
} from './metrics.ts';

const CSV = `date,open,agent_closed,human_closed
2026-11-01,10,0,0
2026-11-05,20,2,8
2026-11-08,24,6,10
2026-11-11,23,10,12
`;

test('parseCsv reads columns by name and sorts by date', () => {
  const rows = parseCsv(
    'human_closed,date,agent_closed,open\r\n3,2026-11-02,1,5\r\n0,2026-11-01,0,4\r\n'
  );
  assert.deepEqual(rows, [
    { date: '2026-11-01', open: 4, agentClosed: 0, humanClosed: 0 },
    { date: '2026-11-02', open: 5, agentClosed: 1, humanClosed: 3 },
  ]);
});

test('parseCsv rejects missing columns and bad values', () => {
  assert.throws(() => parseCsv('date,open\n2026-11-01,1'), /agent_closed/);
  assert.throws(
    () => parseCsv('date,open,agent_closed,human_closed\n2026-11-01,x,0,0'),
    /not a number/
  );
  assert.throws(
    () => parseCsv('date,open,agent_closed,human_closed\nyesterday,1,0,0'),
    /bad date/
  );
  assert.deepEqual(parseCsv(''), []);
});

test('minutesToMidnight follows (1 - agent share) x 60', () => {
  assert.equal(minutesToMidnight(0, 0), 60);
  assert.equal(minutesToMidnight(0, 22), 60);
  assert.equal(minutesToMidnight(1, 3), 45);
  assert.equal(minutesToMidnight(5, 0), 0);
});

test('toPoints derives totals and agent share', () => {
  const [point] = toPoints(parseCsv(CSV)).slice(-1);
  assert.equal(point.totalClosed, 22);
  assert.equal(point.created, 45);
  assert.equal(point.agentShare, 10 / 22);
});

test('velocity is the per-day change over the trailing window', () => {
  const points = toPoints(parseCsv(CSV));
  // 11-05 is only 6 days before 11-11, so a 7-day window starts at 11-01.
  const v = velocity(points, 7);
  assert.equal(v.days, 10);
  assert.equal(v.agent, 1);
  assert.equal(v.human, 1.2);
  assert.equal(v.arrivals, (45 - 10) / 10);
  assert.equal(v.netBacklog, 1.3);

  const short = velocity(points, 3);
  assert.equal(short.days, 3);
  assert.equal(short.agent, 4 / 3);
});

test('velocity is zero with fewer than two days of data', () => {
  const v = velocity(
    toPoints(parseCsv('date,open,agent_closed,human_closed\n2026-11-01,3,0,0'))
  );
  assert.deepEqual(v, {
    agent: 0,
    human: 0,
    arrivals: 0,
    netBacklog: 0,
    days: 0,
  });
});

test('buildSnapshot summarises the latest day', () => {
  const snapshot = buildSnapshot(CSV, 3);
  assert.equal(snapshot.latest.date, '2026-11-11');
  assert.equal(snapshot.openDelta, -1);
  assert.equal(snapshot.daysToClearByAgents, 23 / (4 / 3));

  const idle = buildSnapshot(
    'date,open,agent_closed,human_closed\n2026-11-01,3,0,0\n2026-11-02,5,0,1'
  );
  assert.equal(idle.daysToClearByAgents, Infinity);
  assert.throws(
    () => buildSnapshot('date,open,agent_closed,human_closed\n'),
    /no rows/
  );
});

test('niceCeil rounds up to 1, 2, 2.5 or 5 x 10^n', () => {
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(0.7), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(1.2), 2);
  assert.equal(niceCeil(2.2), 2.5);
  assert.equal(niceCeil(31), 50);
  assert.equal(niceCeil(444), 500);
});

test('threatLevel bands the clock', () => {
  assert.equal(threatLevel(60), 'safe');
  assert.equal(threatLevel(40), 'elevated');
  assert.equal(threatLevel(20), 'severe');
  assert.equal(threatLevel(5), 'critical');
});

test('loadSnapshot fetches the CSV and reports HTTP errors', async () => {
  const ok = (async () => new Response(CSV)) as typeof fetch;
  assert.equal((await loadSnapshot(ok)).latest.open, 23);

  const failing = (async () =>
    new Response('', { status: 404 })) as typeof fetch;
  await assert.rejects(loadSnapshot(failing), /HTTP 404/);
});
