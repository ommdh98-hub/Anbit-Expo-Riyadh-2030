"use client";
import type { Copy } from "./copy";
import type { DailyDose } from "./data";

// "N أيام" with Arabic dual and plural forms.
export function daysText(c: Copy, n: number) {
  const ar = n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${c.num(n)} أيام` : `${c.num(n)} يومًا`;
  return c.t(ar, `${n} ${n === 1 ? "day" : "days"}`);
}

// "N ريات" with Arabic dual and plural forms.
export function eventsText(c: Copy, n: number) {
  const ar = n === 1 ? "رية واحدة" : n === 2 ? "ريتين" : n <= 10 ? `${c.num(n)} ريات` : `${c.num(n)} رية`;
  return c.t(ar, `${n} ${n === 1 ? "irrigation" : "irrigations"}`);
}

// One condition for the Home hero, the Home water card and the Irrigation card:
// "below" under the plant's minimum, "inRange" from the minimum up to the target.
export type DoseMoisture = "below" | "inRange" | null;
export function doseMoisture(current: number | null | undefined, vwcMin: number, target: number | null | undefined): DoseMoisture {
  if (current == null || !Number.isFinite(current)) return null;
  if (current < vwcMin) return "below";
  if (target != null && current < target) return "inRange";
  return null;
}

// The next dose, shared by the Home card and the Irrigation recommendation card:
// line 1 litres for the next irrigation, line 2 L/m² · area · minutes, line 3 the
// moisture state: below the minimum the dose is a recovery dose (one event, or N
// when RAW caps it); the days to the target stay in the Home details.
export function DoseLines({
  c,
  dose,
  method,
  moisture,
  valueClass,
  subClass,
}: {
  c: Copy;
  dose: DailyDose;
  method: "spray" | "drip" | null | undefined;
  moisture: DoseMoisture;
  valueClass: string;
  subClass: string;
}) {
  const how = method === "spray" ? c.t("رش", "spray") : method === "drip" ? c.t("تنقيط", "drip") : "";
  return (
    <>
      <p className={valueClass}>{c.t(`${c.num(dose.litres)} لتر — الرية القادمة`, `${c.num(dose.litres)} L — next irrigation`)}</p>
      <p className={subClass}>
        {[
          c.t(`${c.num(dose.litres_per_m2, 1)} لتر/م²`, `${c.num(dose.litres_per_m2, 1)} L/m²`),
          c.area(dose.effective_area_m2),
          dose.minutes != null ? c.t(`${c.num(dose.minutes)} دقيقة${how ? ` ${how}` : ""}`, `${dose.minutes} min${how ? ` ${how}` : ""}`) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {moisture === "below" && dose.recovery && dose.recovery_events != null && (
        <p className={subClass}>
          {dose.recovery_events === 1
            ? c.t("جرعة استعادة: ترجع الرطوبة إلى النطاق الصحي في رية واحدة", "Recovery dose: moisture returns to the healthy range in one irrigation")
            : c.t(
                `جرعة استعادة: ترجع الرطوبة إلى النطاق الصحي خلال ${eventsText(c, dose.recovery_events)}`,
                `Recovery dose: moisture returns to the healthy range within ${eventsText(c, dose.recovery_events)}`,
              )}
        </p>
      )}
      {moisture === "inRange" && (
        <p className={subClass}>
          {c.t("ضمن النطاق الصحي؛ الرية القادمة تعوّض استهلاك يوم", "Within the healthy range; the next irrigation replaces one day's use")}
        </p>
      )}
    </>
  );
}
