import { DateTime } from "luxon";

export function formatDiscordDate(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

export function formatRange(clockInAt: Date, clockOutAt: Date, timezone: string): string {
  const start = DateTime.fromJSDate(clockInAt).setZone(timezone).toFormat("dd.MM.yyyy HH:mm");
  const end = DateTime.fromJSDate(clockOutAt).setZone(timezone).toFormat("dd.MM.yyyy HH:mm");
  return `${start} - ${end}`;
}

export function durationToHuman(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
