// Small text helpers for the UI. Pure functions, unit tested.

/**
 * Shorten long strings people compare by their ends (pubkys, addresses,
 * hashes): "pubky8pin…435ewo". Keeps the whole string if it is short enough.
 */
export function middleEllipsis(text: string, head = 10, tail = 6): string {
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** "2m ago", "3h ago", "Oct 26": a compact relative time for lists. */
export function relativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestampMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
