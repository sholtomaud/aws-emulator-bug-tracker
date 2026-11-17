import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toPoints } from './metrics.ts';
import { buildAgentQueue } from './insights.ts';
import { buildFrames, frameAt, peakRate } from './replay.ts';

// The agents' queue starts two days before the public issues do.
const agentPoints = buildAgentQueue(
  `date,open,resolved,resolved_by_human
2026-11-01,100,0,0
2026-11-02,120,100,0
2026-11-03,110,300,0
2026-11-04,100,500,100
`
)!.points;
const publicPoints = toPoints(
  parseCsv(`date,open,agent_closed,human_closed
2026-11-03,10,0,0
2026-11-04,16,2,2
`)
);
const frames = buildFrames(publicPoints, agentPoints);

test('buildFrames has one frame per day across both queues', () => {
  assert.deepEqual(
    frames.map((frame) => frame.date),
    ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
  );
  // The public queue does not exist until its first day.
  assert.equal(frames[0].publicQueue, null);
  assert.equal(frames[1].publicQueue, null);
  assert.equal(frames[2].publicQueue?.latest.open, 10);
  // Each frame only knows what was known that day.
  assert.equal(frames[1].agents?.latest.agentClosed, 100);
  assert.equal(frames[1].agents?.velocity.agent, 100);
  assert.equal(frames[3].agents?.latest.humanClosed, 100);
});

test('buildFrames copes with one queue or none', () => {
  assert.equal(buildFrames([], []).length, 0);
  const only = buildFrames(publicPoints, []);
  assert.equal(only.length, 2);
  assert.equal(only[0].agents, null);
});

test('frameAt returns whole days exactly and blends between them', () => {
  assert.equal(frameAt(frames, 2), frames[2]);
  assert.equal(frameAt(frames, -1), frames[0]);
  assert.equal(frameAt(frames, 99), frames[3]);

  const half = frameAt(frames, 1.5);
  assert.equal(half.agents?.latest.agentClosed, 200);
  assert.equal(half.agents?.latest.open, 115);
  // Rates blend too: 100 a day after one day, 150 a day after two.
  assert.equal(half.agents?.velocity.agent, 125);

  // Half-way into the day people first resolve something.
  const mixed = frameAt(frames, 2.5).agents!.latest;
  assert.equal(mixed.humanClosed, 50);
  assert.equal(mixed.agentClosed, 350);
  assert.equal(mixed.agentShare, 350 / 400);
});

test('frameAt blends ratios on a log scale', () => {
  const a = frames[1].agents!.loop.ratio!; // 120 filed / 100 resolved
  const b = frames[2].agents!.loop.ratio!;
  const mid = frameAt(frames, 1.5).agents!.loop.ratio!;
  assert.ok(Math.abs(mid - Math.sqrt(a * b)) < 1e-9);
});

test('a queue appears on its first day, not before', () => {
  assert.equal(frameAt(frames, 1.9).publicQueue, null);
  assert.equal(frameAt(frames, 2).publicQueue?.latest.open, 10);
});

test('peakRate finds the largest rate in the record', () => {
  assert.equal(
    peakRate(frames, (frame) => frame.agents?.velocity ?? null),
    Math.max(
      ...frames.flatMap((f) =>
        f.agents ? [f.agents.velocity.agent, f.agents.velocity.arrivals] : []
      )
    )
  );
  assert.equal(
    peakRate([], () => null),
    0
  );
});
