export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DEFAULT_FIRST_DAY_OF_WEEK: IsoWeekday = 7;

export function normalizeFirstDayOfWeek(value: number | null | undefined): IsoWeekday {
  return Number.isInteger(value) && value != null && value >= 1 && value <= 7
    ? (value as IsoWeekday)
    : DEFAULT_FIRST_DAY_OF_WEEK;
}

export function startOfCalendarWeek(
  date: Date,
  firstDayOfWeek: number | null | undefined,
): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const firstDayJs = normalizeFirstDayOfWeek(firstDayOfWeek) % 7;
  const daysSinceFirst = (start.getDay() - firstDayJs + 7) % 7;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() - daysSinceFirst,
  );
}

export function getCalendarWeekDays(
  date: Date,
  firstDayOfWeek: number | null | undefined,
): Date[] {
  const start = startOfCalendarWeek(date, firstDayOfWeek);
  return Array.from(
    { length: 7 },
    (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
  );
}