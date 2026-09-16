import { evaluateFormula } from "../src/index.ts";

const maxCalls = 5_000;
const requestedCalls = Number(process.env.FORMULA_PROFILE_CALLS ?? maxCalls);
const calls = Number.isFinite(requestedCalls)
  ? Math.min(maxCalls, Math.max(1, Math.trunc(requestedCalls)))
  : maxCalls;
const originalDateTimeFormat = Intl.DateTimeFormat;
let constructorCount = 0;
const CountedDateTimeFormat = function (
  this: unknown,
  ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
) {
  constructorCount++;
  return new originalDateTimeFormat(...args);
} as unknown as typeof Intl.DateTimeFormat;
Object.defineProperty(CountedDateTimeFormat, "prototype", {
  value: originalDateTimeFormat.prototype,
});
Object.defineProperty(Intl, "DateTimeFormat", {
  value: CountedDateTimeFormat,
  writable: true,
  configurable: true,
});

const fixedNow = new Date("2024-01-10T12:00:00Z");
const options = { timeZone: "Asia/Jerusalem", now: fixedNow };
const memory = () => {
  const value = process.memoryUsage();
  return {
    rssMiB: Math.round(value.rss / 1024 / 1024 * 10) / 10,
    heapUsedMiB: Math.round(value.heapUsed / 1024 / 1024 * 10) / 10,
    externalMiB: Math.round(value.external / 1024 / 1024 * 10) / 10,
  };
};
const before = memory();
let aggregateResultLength = 0;
for (let index = 0; index < calls; index++) {
  const expression = index % 3 === 0
    ? "today()"
    : index % 3 === 1
      ? "daysSince('2024-01-07')"
      : "daysUntil('2024-01-14')";
  const result = evaluateFormula(expression, {}, options);
  if (typeof result === "string") aggregateResultLength += result.length;
}
const after = memory();

console.log(JSON.stringify({
  calls,
  constructorCount,
  aggregateResultLength,
  before,
  after,
  delta: {
    rssMiB: Math.round((after.rssMiB - before.rssMiB) * 10) / 10,
    heapUsedMiB: Math.round((after.heapUsedMiB - before.heapUsedMiB) * 10) / 10,
    externalMiB: Math.round((after.externalMiB - before.externalMiB) * 10) / 10,
  },
}));

Object.defineProperty(Intl, "DateTimeFormat", {
  value: originalDateTimeFormat,
  writable: true,
  configurable: true,
});