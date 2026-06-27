const PREFIX = process.env.NEXT_PUBLIC_TICKET_PREFIX ?? "TKT";

export function ticketId(ticket_number: number | null | undefined): string {
  if (!ticket_number) return "—";
  return `${PREFIX}-${String(ticket_number).padStart(4, "0")}`;
}
