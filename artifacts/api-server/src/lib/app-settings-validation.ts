import {
  DEFAULT_WORKING_DAYS,
  isValidFormulaWorkingDays,
} from "@workspace/formula";

export const DEFAULT_FIRST_DAY_OF_WEEK = 7;

type AppCalendarSettingsInput = {
  workingDays?: readonly number[] | null;
  firstDayOfWeek?: number | null;
};

export function normalizeAppCalendarSettings(input: AppCalendarSettingsInput): {
  workingDays: number[];
  firstDayOfWeek: number;
} {
  return {
    workingDays:
      input.workingDays && isValidFormulaWorkingDays(input.workingDays)
        ? [...input.workingDays]
        : [...DEFAULT_WORKING_DAYS],
    firstDayOfWeek:
      input.firstDayOfWeek != null &&
      Number.isInteger(input.firstDayOfWeek) &&
      input.firstDayOfWeek >= 1 &&
      input.firstDayOfWeek <= 7
        ? input.firstDayOfWeek
        : DEFAULT_FIRST_DAY_OF_WEEK,
  };
}

export function validateAppCalendarSettingsUpdate(input: AppCalendarSettingsInput): string | null {
  if (
    input.workingDays !== undefined &&
    (!input.workingDays || !isValidFormulaWorkingDays(input.workingDays))
  ) {
    return "Working days must be unique ISO weekdays from 1 to 7";
  }
  if (
    input.firstDayOfWeek !== undefined &&
    (input.firstDayOfWeek == null ||
      !Number.isInteger(input.firstDayOfWeek) ||
      input.firstDayOfWeek < 1 ||
      input.firstDayOfWeek > 7)
  ) {
    return "First day of week must be an ISO weekday from 1 to 7";
  }
  return null;
}