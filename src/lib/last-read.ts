const KEY = "cunav_last_read";

function getMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markRead(ticketId: string): void {
  const map = getMap();
  map[ticketId] = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function hasUnread(ticketId: string, updatedAt: string): boolean {
  const map = getMap();
  const lastRead = map[ticketId];
  if (!lastRead) return true;
  return new Date(updatedAt) > new Date(lastRead);
}
