const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// Spelt out in full: the widget shows one date and it is read from across a
// room. Assembled from parts rather than formatted whole so the order stays
// "Friday 5 September" whatever en-GB decides to do with a weekday.
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', weekday: 'long', day: 'numeric', month: 'long',
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

export type ClockFrame = { text: string; minute: number | null; previous: string | null };
export type ClockDate = { label: string; dateTime?: string };

/** Format the display date in the dashboard's fixed Copenhagen time zone. */
export function clockDate(now: Date | null): ClockDate {
  if (!now) return { label: '—' };
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(now).map(part => [part.type, part.value]));
  const spelt = Object.fromEntries(dateFormatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    label: `${spelt.weekday} ${spelt.day} ${spelt.month}`,
    dateTime: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

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
