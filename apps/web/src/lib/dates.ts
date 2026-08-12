const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FormatterOptions = Intl.DateTimeFormatOptions;

const DEFAULT_PLAIN_DATE_OPTIONS: FormatterOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};

const DEFAULT_INSTANT_DATE_OPTIONS: FormatterOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const pad = (value: number) => value.toString().padStart(2, "0");

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

export const toPlainDateString = (
  value: Date | string | null | undefined
): string | null => {
  if (!value) return null;

  if (typeof value === "string" && PLAIN_DATE_PATTERN.test(value)) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!isValidDate(date)) return null;

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
};

export const parsePlainDate = (value: string): Date => {
  if (!PLAIN_DATE_PATTERN.test(value)) {
    throw new Error(`Invalid plain date: ${value}`);
  }

  const [yearPart, monthPart, dayPart] = value.split("-");
  if (!yearPart || !monthPart || !dayPart) {
    throw new Error(`Invalid plain date: ${value}`);
  }

  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const day = Number.parseInt(dayPart, 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    !isValidDate(date) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid plain date: ${value}`);
  }

  return date;
};

export const formatPlainDate = (
  value: Date | string | null | undefined,
  options: FormatterOptions = DEFAULT_PLAIN_DATE_OPTIONS,
  locale?: string
): string => {
  const plainDate = toPlainDateString(value);
  if (!plainDate) return "";

  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(parsePlainDate(plainDate));
};

export const getPacificTodayPlainDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to derive Pacific date");
  }

  return `${year}-${month}-${day}`;
};

export const getPlainDateYear = (
  value: Date | string | null | undefined
): number | null => {
  const plainDate = toPlainDateString(value);
  if (!plainDate) return null;

  return Number.parseInt(plainDate.slice(0, 4), 10);
};

export const formatInstantLocal = (
  value: Date | string | null | undefined,
  options: FormatterOptions = DEFAULT_INSTANT_DATE_OPTIONS,
  locale?: string
): string => {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (!isValidDate(date)) return "";

  return new Intl.DateTimeFormat(locale, options).format(date);
};
