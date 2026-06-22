import { env } from "../config/env.js";

export function isoNow(): string {
  return new Date().toISOString();
}

export function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export function toNotionDate(value?: string | null): { start: string } | null {
  if (!value) {
    return null;
  }

  return { start: value };
}

export function formatDisplayDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: env.DISPLAY_TIME_ZONE
  }).format(date);
}
