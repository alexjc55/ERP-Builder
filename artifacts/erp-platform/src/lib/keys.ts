const CYR_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export function slugifyKey(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) {
    if (ch in CYR_MAP) out += CYR_MAP[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "_";
  }
  out = out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (out !== "" && !/^[a-z]/.test(out)) out = `f_${out}`;
  return out;
}

export function uniqueKey(base: string, existing: Set<string>): string {
  if (base === "" || !existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
