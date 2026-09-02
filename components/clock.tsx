'use client';

import { useState, type CSSProperties } from 'react';
import { changedDigits, clockDate, clockFrame } from '@/lib/clock-motion';

export default function Clock({ now }: { now: Date | null }) {
  const [frame, setFrame] = useState(() => clockFrame(now));
  const next = clockFrame(now, frame);
  if (next !== frame) setFrame(next);
  const digits = changedDigits(next);
  const date = clockDate(now);

  return <div className="clock-block">
    <h1 className={'clock' + (now ? ' is-live' : '')} aria-label={now ? next.text : 'Loading time'}>
      {digits.map(({ digit, previous }, index) => <span className={'clock-digit digit-' + index} key={index} aria-hidden="true" style={{ '--roll-delay': (3 - index) * 35 + 'ms' } as CSSProperties}>
        {previous !== null && <span className="digit-face digit-out" key={'out-' + next.minute}>{previous}</span>}
        <span className={'digit-face' + (previous !== null ? ' digit-in' : '')} key={'in-' + next.minute}>{digit}</span>
      </span>)}
      <span className="separator" aria-hidden="true"><span /><span /></span>
    </h1>
    <time className="clock-date" dateTime={date.dateTime} aria-label={now ? 'Date: ' + date.label : 'Loading date'}>{date.label}</time>
  </div>;
}
