import { tenantHopPoint, type HopArc, type TopKind } from './clock-tenant';

// These are browser-independent animation data. The small simulations run
// once when an action begins, never in a requestAnimationFrame/React loop.
export type MotionFrame = { offset: number; transform: string };
export type MotionClip = { duration: number; body: MotionFrame[]; head: MotionFrame[]; sprout: MotionFrame[] };
const n = (value: number) => Math.abs(value) < 0.0005 ? 0 : Math.round(value * 1000) / 1000;
const transform = (x = 0, y = 0, angle = 0, sx = 1, sy = 1) =>
  `translate(${n(x)}px,${n(y)}px) rotate(${n(angle)}deg) scale(${n(sx)},${n(sy)})`;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export function jumpChargeFrames(arc: HopArc, current: string): MotionFrame[] {
  const { from, squash } = arc;
  return [
    { offset: 0, transform: current },
    { offset: 0.22, transform: transform(from.x, from.y, 0, 0.99, 1.025) },
    { offset: 0.84, transform: transform(from.x, from.y, 0, 1 + squash * 0.7, 1 - squash) },
    { offset: 1, transform: transform(from.x, from.y, 0, 1 + squash * 0.7, 1 - squash) },
  ];
}

export function jumpFlightFrames(arc: HopArc): MotionFrame[] {
  const direction = Math.sign(arc.to.x - arc.from.x);
  const frames: MotionFrame[] = [];
  // 48 samples bound the parabola's linear interpolation error well below a
  // pixel at TV size, including the exact physical apex and contact instant.
  const samples = [...new Set([...Array.from({ length: 49 }, (_, i) => i / 48), arc.apexAt])].sort((a,b) => a-b);
  for (const at of samples) {
    const { x, y } = tenantHopPoint(arc, at);
    const launch = smooth(at / 0.12);
    const stretch = 0.12 * Math.exp(-at * 5) * launch;
    const squash = arc.squash * (1 - launch);
    const angle = direction * 6 * Math.sin(Math.PI * at) * (1 - 2 * at);
    frames.push({ offset: at * arc.flightMs / arc.duration,
      transform: transform(x, y, angle, 1 + squash * 0.7 - stretch * 0.6, 1 - squash + stretch) });
  }
  // A damped compression impulse on contact. The feet stay on the surface;
  // there is no second hop or unexplained horizontal slide after landing.
  const impact = Math.min(0.3, 0.12 + arc.impactSpeed / arc.gravity * 0.23);
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const compression = impact * Math.exp(-5.5 * t) * Math.sin(t * Math.PI * 2.2) * (1 - smooth((t - 0.75) / 0.25)) * 2;
    frames.push({ offset: (arc.flightMs + t * arc.settleMs) / arc.duration,
      transform: transform(arc.to.x, arc.to.y, 0, 1 + compression * 0.65, 1 - compression) });
  }
  return frames;
}

function randomSource(seed: number) {
  let state = (seed * 0xffffffff) >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
}

type Spring = { value: number; speed: number };
function step(spring: Spring, target: number, stiffness: number, damping: number, dt: number) {
  spring.speed += ((target - spring.value) * stiffness - spring.speed * damping) * dt;
  spring.value += spring.speed * dt;
}

// A pelvis finding equilibrium, with a slower head and a light flexible
// sprout following it. Uneven, seeded shifts include quiet intervals. Damping
// decides the recovery, not a prescribed left-right-left keyframe sequence.
export function balanceClip(kind: TopKind, seed = 0.5): MotionClip {
  const random = randomSource(seed);
  const amplitude = { flat: 0.55, round: 2.6, ledge: 3.8, ball: 5.2 }[kind];
  const shifts: { at: number; value: number }[] = [{ at: 0, value: 0 }];
  for (let at = 0.45; at < 13.8; at += 0.9 + random() * 2.1) {
    shifts.push({ at, value: random() < 0.25 ? 0 : (random() * 2 - 1) * amplitude });
  }
  shifts.push({ at: 14, value: 0 });
  let index = 0;
  return springClip(16_000, time => {
    while (index + 1 < shifts.length && shifts[index + 1].at <= time) index++;
    return shifts[index].value;
  }, 0.23, 0.12);
}

// The eyes acquire the edge first (CSS); the torso follows with a little
// hesitation. Each visit varies direction, depth and observation time.
export function postureClip(action: 'peer' | 'teeter' | 'lean', seed = 0.5, direction = -1): MotionClip {
  const random = randomSource(seed);
  const depth = action === 'teeter' ? 4 + random() * 2 : 6.5 + random() * 3;
  const duration = Math.round((action === 'teeter' ? 2700 : 3400) + random() * 700);
  const hold = 0.52 + random() * 0.1;
  const clip = springClip(duration, time => {
    const p = time * 1000 / duration;
    if (action === 'teeter') return direction * depth * Math.exp(-p * 9) * smooth(p / 0.12);
    const enter = smooth((p - 0.06) / 0.18);
    const leave = 1 - smooth((p - hold) / 0.17);
    // A small second look, not a rigid hold on the extreme pose.
    const secondLook = 1 - 0.12 * Math.exp(-(((p - 0.43) / 0.06) ** 2));
    return direction * depth * enter * leave * secondLook;
  }, 0.28, action === 'teeter' ? 0.18 : 0.1);
  return clip;
}

function springClip(duration: number, target: (seconds: number) => number, shift: number, headLag: number): MotionClip {
  const body: Spring = { value: 0, speed: 0 };
  const head: Spring = { value: 0, speed: 0 };
  const sprout: Spring = { value: 0, speed: 0 };
  const clip: MotionClip = { duration, body: [], head: [], sprout: [] };
  const steps = Math.ceil(duration / 1000 * 120);
  const dt = duration / 1000 / steps;
  for (let i = 0; i <= steps; i++) {
    if (i) {
      step(body, target(i * dt), 70, 13, dt);
      step(head, -body.value * 0.5, 46, 11, dt);
      step(sprout, -body.speed * 0.2 - body.value * 0.2, 85, 9, dt);
    }
    if (i % 5 !== 0 && i !== steps) continue;
    const offset = i / steps;
    const settle = 1 - smooth((offset - 0.94) / 0.06);
    const angle = body.value * settle;
    clip.body.push({ offset, transform: transform(-angle * shift, 0, angle, 1 + Math.abs(angle) * 0.001, 1 - Math.abs(angle) * 0.001) });
    clip.head.push({ offset, transform: transform(0, Math.abs(angle) * headLag, head.value * settle) });
    clip.sprout.push({ offset, transform: transform(0, 0, sprout.value * settle) });
  }
  return clip;
}
