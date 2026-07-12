export type LimitedText = {
  value: string;
  overflow: string;
  changed: boolean;
};

export function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function charLength(value: string) {
  return Array.from(value).length;
}

export function limitText(value: unknown, maxChars: number): LimitedText {
  const normalized = normalizeText(value);
  const chars = Array.from(normalized);
  if (chars.length <= maxChars) {
    return { value: normalized, overflow: "", changed: normalized !== String(value ?? "").trim() };
  }

  return {
    value: chars.slice(0, maxChars).join("").trim(),
    overflow: chars.slice(maxChars).join("").trim(),
    changed: true
  };
}

export function splitText(value: unknown, limits: number[]) {
  const chars = Array.from(normalizeText(value));
  let offset = 0;
  const parts = limits.map((limit) => {
    const part = chars.slice(offset, offset + limit).join("").trim();
    offset += limit;
    return part;
  });
  const overflow = chars.slice(offset).join("").trim();

  return {
    parts,
    overflow,
    changed: overflow.length > 0 || parts.join("") !== chars.join("")
  };
}

export function compactJoin(values: unknown[], separator = " ") {
  return values.map(normalizeText).filter(Boolean).join(separator).trim();
}

export function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function positiveInteger(value: unknown, fallback = 1) {
  const parsed = Math.floor(numeric(value, fallback));
  return parsed > 0 ? parsed : fallback;
}
