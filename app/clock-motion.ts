const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export type ClockFrame = { text: string; minute: number | null; previous: string | null };

export function clockFrame(now: Date | null, previous?: ClockFrame): ClockFrame {
  const minute = now ? Math.floor(now.getTime() / 60000) : null;
  const text = now ? formatter.format(now) : '––:––';
  if (previous?.minute === minute) return previous;
  // Snap on first load, a resumed screen, or a clock correction. Only a
  // normal minute tick rolls; never replay missed minutes on the TV.
  const consecutive = minute !== null && previous?.minute != null && minute === previous.minute + 1;
  return { text, minute, previous: consecutive ? previous.text : null };
}

export function changedDigits(frame: ClockFrame) {
  return [...frame.text.replace(':', '')].map((digit, index) => ({
    digit,
    previous: frame.previous && frame.previous.replace(':', '')[index] !== digit
      ? frame.previous.replace(':', '')[index] : null,
  }));
}
