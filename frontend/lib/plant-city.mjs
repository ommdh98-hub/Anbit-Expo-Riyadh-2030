// Informational display helpers only; never imported by the irrigation engine.
export const assessmentLabels = {
  100: "يطابق معياري الحرارة والرطوبة الجوية",
  50: "يطابق معيارًا واحدًا",
  0: "لا يطابق المعيارين وفق البيانات المتاحة",
};
export function cityResults(data, cityId) {
  return data.assessments
    .filter((row) => row.city_id === cityId)
    .toSorted((a, b) => b.score - a.score || a.plant_id - b.plant_id);
}
export const plantNames = [
  "",
  "نخيل التمر",
  "المانجو",
  "الرمان",
  "الجوافة",
  "العنب",
  "الزيتون",
  "البرتقال واليوسفي",
  "الليمون اللايم والليمون",
  "الشمام",
  "البابايا",
  "التين الشوكي",
  "الطماطم",
  "الخيار",
  "الفلفل الحلو",
  "الباذنجان",
  "البصل",
  "البطاطس",
];
export const cityNames = [
  "",
  "الرياض",
  "مكة المكرمة",
  "المدينة المنورة",
  "جازان",
  "القصيم",
  "الباحة",
  "أبها",
  "الطائف",
  "الجوف",
  "حائل",
  "تبوك",
  "نجران",
  "الأحساء",
  "الخرج",
];
