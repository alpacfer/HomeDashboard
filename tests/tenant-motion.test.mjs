import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantHopArc, tenantHopPoint } from '../lib/clock-tenant.ts';
import { balanceClip, postureClip, jumpChargeFrames, jumpFlightFrames } from '../lib/tenant-motion.ts';

const near = (a, b, epsilon = 0.00001) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const numbers = frame => frame.transform.match(/-?\d+(?:\.\d+)?/g).map(Number);

test('jumps have constant horizontal speed and gravity, and hit both pads exactly', () => {
  for (const to of [{x:180,y:0}, {x:100,y:-80}, {x:-150,y:120}, {x:0,y:0}]) {
    const from = {x:0,y:0};
    const arc = tenantHopArc(from, to, 48);
    assert.deepEqual(tenantHopPoint(arc, 0), from);
    assert.deepEqual(tenantHopPoint(arc, 1), to);
    const points = Array.from({length:21}, (_, i) => tenantHopPoint(arc, i/20));
    for (let i=1; i<20; i++) {
      near(points[i+1].x-2*points[i].x+points[i-1].x, 0);
      near(points[i+1].y-2*points[i].y+points[i-1].y, arc.gravity*(arc.flightMs/1000/20)**2);
    }
    near(tenantHopPoint(arc, arc.apexAt).y, arc.apex.y);
    assert.ok(arc.apex.y < Math.min(from.y,to.y) - 48);
    assert.ok(arc.chargeMs >= 330 && arc.chargeMs <= 560);
  }
});

test('ceiling limits the arc, while a deep drop increases landing recovery', () => {
  const up = tenantHopArc({x:0,y:0}, {x:80,y:-70}, 48, -100);
  near(up.apex.y, -100);
  const level = tenantHopArc({x:0,y:0}, {x:80,y:0}, 48);
  const down = tenantHopArc({x:0,y:0}, {x:80,y:220}, 48);
  assert.ok(down.impactSpeed > level.impactSpeed);
  assert.ok(down.settleMs > level.settleMs);
  assert.ok(down.apexAt < 0.5);
});

test('charge joins flight without a snap and recovery keeps feet planted', () => {
  const arc = tenantHopArc({x:10,y:20}, {x:190,y:100}, 48);
  const charge = jumpChargeFrames(arc, 'matrix(1,0,0,1,10,20)');
  const flight = jumpFlightFrames(arc);
  assert.equal(charge.at(-1).transform, flight[0].transform);
  assert.equal(charge[0].transform, 'matrix(1,0,0,1,10,20)');
  const contact = arc.flightMs / arc.duration;
  for (const frame of flight.filter(frame => frame.offset >= contact)) {
    assert.deepEqual(numbers(frame).slice(0,2), [190,100]);
  }
  assert.deepEqual(numbers(flight.at(-1)), [190,100,0,1,1]);
  assert.equal(flight.at(-1).offset, 1);
  for (let i=1;i<flight.length;i++) assert.ok(flight[i].offset > flight[i-1].offset);
});

test('sampled flight never deviates more than a fraction of a pixel from gravity', () => {
  const arc = tenantHopArc({x:0,y:0}, {x:200,y:200}, 48);
  const frames = jumpFlightFrames(arc).filter(frame => frame.offset <= arc.flightMs/arc.duration);
  for (let i=1;i<frames.length;i++) {
    const at = (frames[i-1].offset+frames[i].offset)/2 * arc.duration/arc.flightMs;
    const y = (numbers(frames[i-1])[1]+numbers(frames[i])[1])/2;
    near(y, tenantHopPoint(arc, at).y, 0.15);
  }
});

test('spring tracks vary between visits, stay bounded and finish at equilibrium', () => {
  assert.deepEqual(balanceClip('round',0.4), balanceClip('round',0.4));
  assert.notDeepEqual(balanceClip('round',0.4).body, balanceClip('round',0.8).body);
  for (const clip of [balanceClip('ball',0.1), balanceClip('round',0.7), postureClip('peer',0.3), postureClip('teeter',0.6)]) {
    assert.ok(clip.body.length < 400, 'bounded compositor keyframes');
    for (const track of [clip.body,clip.head,clip.sprout]) {
      assert.deepEqual(numbers(track[0]), [0,0,0,1,1]);
      assert.deepEqual(numbers(track.at(-1)), [0,0,0,1,1]);
      for (const frame of track) assert.ok(numbers(frame).every(Number.isFinite));
      assert.ok(Math.max(...track.map(frame => Math.abs(numbers(frame)[2]))) < 15);
    }
    assert.notDeepEqual(clip.head, clip.body, 'head follows on its own time');
    assert.notDeepEqual(clip.sprout, clip.body, 'sprout is a lighter spring');
  }
});
