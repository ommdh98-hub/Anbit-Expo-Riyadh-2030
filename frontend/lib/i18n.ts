import dictionary from "./translations.json";
const entries: Record<string, string> = dictionary;
const arabicLetters = "\\u0621-\\u064a";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One pass preserves embedded values and avoids translating replacement text again.
const patterns = Object.keys(entries)
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const startsArabic = /^[\u0621-\u064a]/.test(key);
    const endsArabic = /[\u0621-\u064a]$/.test(key);
    return `${startsArabic ? `(?<![${arabicLetters}])` : ""}${escape(key)}${endsArabic ? `(?![${arabicLetters}])` : ""}`;
  });
const phrases = new RegExp(patterns.join("|"), "gu");
export function currentLanguage(): "ar" | "en" {
  return typeof document !== "undefined" &&
    document.documentElement.lang === "en"
    ? "en"
    : "ar";
}
export function translate(text: string, language = currentLanguage()): string {
  if (language === "ar") return text;
  const normalized = text.trim().replace(/\s+/g, " ");
  if (entries[normalized])
    return (
      (text.match(/^\s*/)?.[0] ?? "") +
      entries[normalized] +
      (text.match(/\s*$/)?.[0] ?? "")
    );
  return text
    .replace(phrases, (match) => entries[match])
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}
// Presentation only: numbers, React elements, IDs and input values retain their identity.
export function display<T>(value: T): T {
  return (typeof value === "string" ? translate(value) : value) as T;
}
