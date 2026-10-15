import type { Zone } from "./types";

const teamNavigation = [
  { id: "overview", label: "إدارة المسطحات الخضراء" },
  { id: "plants", label: "النباتات والمدن" },
  { id: "map", label: "الخريطة والتوأم" },
  { id: "decisions", label: "قرارات الري" },
  { id: "water", label: "تقارير المياه" },
] as const;
const individualNavigation = [
  { id: "overview", label: "اكتشف نباتك" },
  { id: "plants", label: "دليل النباتات" },
  { id: "map", label: "معلومات التربة والري" },
] as const;
export function navigationFor(role: "user" | "survey") {
  return role === "survey" ? teamNavigation : individualNavigation;
}
// Presentation of the API's classification, not a second decision engine.
export function measurementStatus(zone: Zone) {
  const code = zone.decision.code;
  if (code === "measure") return "توزيع القياسات غير كافٍ";
  if (code === "conflict") return "القراءات تحتاج إلى التحقق";
  if (["review", "high", "defer"].includes(code))
    return "القراءات متاحة للتقييم وفق إعدادات المنطقة";
  return "نحتاج قراءة حديثة متحققة أو استكمال متطلبات القياس";
}
export function suggestedMeasurement(zone: Zone) {
  const p = zone.decision.coverage?.next_point;
  if (
    !p ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < zone.x ||
    p.x > zone.x + zone.width ||
    p.y < zone.y ||
    p.y > zone.y + zone.height
  )
    return null;
  return p;
}
