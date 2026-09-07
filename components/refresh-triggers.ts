// The three ways a panel is asked to refresh outside its own timer: the page
// becoming visible again, the network coming back, and a key on the remote.
//
// Five components registered this trio by hand, three of them with their own
// keydown handler on window, and the aria-labels' promise of "Press OK to
// retry" was kept by two of the five. One registration, one teardown, and the
// key list says which panels honour the remote at all.

export type RefreshTriggerOptions = {
  // Keys that ask for a refresh. A press on a focused link is left to the
  // link: the D-pad's OK on an attribution must open it, not refresh a card.
  keys?: readonly string[];
  // What coming back online does, when that differs from becoming visible.
  // The forecast map clears its backoff first; everything else just refreshes.
  online?: () => void;
};

export function onRefreshTriggers(refresh: () => void, { keys = [], online }: RefreshTriggerOptions = {}): () => void {
  const resume = () => { if (!document.hidden) refresh(); };
  const back = online ?? resume;
  const key = (event: KeyboardEvent) => {
    if (!keys.includes(event.key)) return;
    if ((event.target as HTMLElement | null)?.closest?.('a')) return;
    refresh();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', back);
  if (keys.length) window.addEventListener('keydown', key);
  return () => {
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', back);
    if (keys.length) window.removeEventListener('keydown', key);
  };
}
