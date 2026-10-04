// Synthetic demonstration values for the card preview. Pure and deterministic:
// derived only from field metadata (type/options), never from real records.

export interface DemoFieldLike {
  fieldKey: string;
  fieldType: string;
  optionsJson?: unknown;
  relationConfigJson?: { selectionMode?: string | null } | null;
}
export type DemoValue =
  | { kind: "text"; value: string }
  | { kind: "multiline"; value: string }
  | { kind: "number"; value: number; suffix?: string }
  | { kind: "date"; value: string }
  | { kind: "datetime"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "options"; values: string[] }
  | { kind: "link"; value: string; href: string }
  | { kind: "file"; value: string }
  | { kind: "user"; value: string }
  | { kind: "relation"; values: string[] }
  | { kind: "status"; value: string }
  | { kind: "formula"; value: string };

const NUMBERS = [1284.5, 37, 9120.75, 412, 63.4];
const WORDS = ["Северный склад", "Партия A-17", "Заказ 4821", "Сверка за март", "Монтаж линии 3"];
const PEOPLE = ["Анна Ковалёва", "Даниэль Леви", "Олег Миронов"];
const RELATED = ["Запись 1042", "Запись 1043", "Запись 2210"];

function optionValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(o => typeof o === "string" ? o : o && typeof o === "object" && typeof (o as { value?: unknown }).value === "string" ? (o as { value: string }).value : "")
    .filter(Boolean);
}

/** Deterministic demo value for a field; `seed` varies rows of a mock table. */
export function demoValue(f: DemoFieldLike, seed = 0): DemoValue {
  const i = Math.abs(seed);
  const day = String(3 + (i * 7) % 25).padStart(2, "0");
  switch (f.fieldType) {
    case "number": return { kind: "number", value: NUMBERS[i % NUMBERS.length] };
    case "percent": return { kind: "number", value: [47.2, 12.5, 88.1][i % 3], suffix: "%" };
    case "boolean": return { kind: "boolean", value: i % 2 === 0 };
    case "date": return { kind: "date", value: `2025-04-${day}` };
    case "datetime": case "created_at": case "updated_at": return { kind: "datetime", value: `2025-04-${day} 14:${String(10 + i).padStart(2, "0")}` };
    case "select": case "multiselect": {
      const opts = optionValues(f.optionsJson);
      return { kind: "options", values: opts.length ? [opts[i % opts.length]] : ["—"] };
    }
    case "status": return { kind: "status", value: "status" };
    case "email": return { kind: "link", value: `demo${i + 1}@example.test`, href: `mailto:demo${i + 1}@example.test` };
    case "url": return { kind: "link", value: "https://example.test/demo", href: "https://example.test/demo" };
    case "phone": return { kind: "text", value: `+972 3 555 01${String(20 + i)}` };
    case "textarea": return { kind: "multiline", value: `${WORDS[i % WORDS.length]}\n${WORDS[(i + 2) % WORDS.length]}` };
    case "file": return { kind: "file", value: `document-${i + 1}.pdf` };
    case "user": return { kind: "user", value: PEOPLE[i % PEOPLE.length] };
    case "relation": case "lookup": case "page_ref": {
      const multi = f.relationConfigJson?.selectionMode === "multiple";
      return { kind: "relation", values: multi ? [RELATED[i % 3], RELATED[(i + 1) % 3]] : [RELATED[i % 3]] };
    }
    case "function": case "formula": return { kind: "formula", value: String(NUMBERS[(i + 1) % NUMBERS.length]) };
    default: return { kind: "text", value: WORDS[i % WORDS.length] };
  }
}

export function demoValueText(v: DemoValue): string {
  switch (v.kind) {
    case "number": return `${v.value}${v.suffix ?? ""}`;
    case "boolean": return v.value ? "✓" : "—";
    case "options": case "relation": return v.values.join(", ");
    default: return v.value;
  }
}
