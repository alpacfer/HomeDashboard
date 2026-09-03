// The last good answer from each provider, kept on the device so a reload
// shows a forecast at once and costs no request while the data is still
// current. Storage is an input like any other: every read goes through a
// validator from lib/, and a shape that does not match is discarded rather
// than trusted. Storage can be disabled or full on a TV browser, so every
// failure here is silent and the display works without it.

export function readStored<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a disabled store. The next fetch still happens; only the
    // head start after a reload is lost.
  }
}
