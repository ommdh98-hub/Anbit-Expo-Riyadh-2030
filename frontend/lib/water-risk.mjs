// A local proposal comparison, never an execution or a water-savings calculation.
export function waterRisk(proposed, estimate) {
  if (
    !Number.isFinite(proposed) ||
    proposed < 0 ||
    !Number.isFinite(estimate) ||
    estimate < 0
  )
    return "لا يمكن تقييم خطر الإفراط بالبيانات الحالية";
  return proposed > estimate
    ? "قد تتجاوز الكمية المقترحة الاحتياج المحسوب"
    : "لا يظهر تجاوز للكمية الحسابية وفق الافتراضات";
}
