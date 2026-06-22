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
