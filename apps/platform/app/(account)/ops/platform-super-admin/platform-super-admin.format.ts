export function formatPlatformSuperAdminDate(
  formatter: Intl.DateTimeFormat,
  value: string
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
