"use client";
import { currentLanguage, display as t } from "../lib/i18n";
import care from "../data/growing-guides.json";
import {
  BookOpen,
  Droplets,
  Leaf,
  Sun,
  CalendarDays,
  Sprout,
} from "lucide-react";

type Bilingual = { ar: string; en: string };
type Guide = {
  source_ids: string[];
  description: Bilingual;
  season: Bilingual;
  place: Bilingual;
  steps: Bilingual[];
  care: Bilingual;
  tips: Bilingual;
};
const guides: Record<string, Guide> = care.guides;
const sources: Record<string, { title: string; url: string; context: string }> =
  care.sources;
const explorer: Record<string, string> = care.explorer;
export function guideForPlant(id: number | string): Guide | undefined {
  return guides[typeof id === "number" ? explorer[String(id)] : id];
}
export function careText(text: Bilingual): string {
  return text[currentLanguage()];
}
export default function GrowingGuide({
  plantId,
  name,
  city,
  suitability,
}: {
  plantId: number | string;
  name: string;
  city?: string;
  suitability?: string;
}) {
  const guide = guideForPlant(plantId);
  if (!guide)
    return <p role="status">{t("لا تتوفر إرشادات موثقة لهذا النبات بعد.")}</p>;
  const sections = [
    { title: "الوقت المناسب للزراعة", icon: CalendarDays, value: guide.season },
    { title: "تجهيز المكان والتربة", icon: Sun, value: guide.place },
    { title: "خطوات الزراعة", icon: Sprout, value: null },
    { title: "الري والعناية", icon: Droplets, value: guide.care },
    { title: "نصائح مهمة", icon: Leaf, value: guide.tips },
  ];
  return (
    <div className="growing-guide" data-plant={plantId}>
      <header className="care-title">
        <BookOpen aria-hidden size={24} />
        <div>
          <h3>
            {t("كيفية الزراعة")} · {t(name)}
          </h3>
          {city && (
            <p>
              {t(city)} · {t(suitability ?? "")}
            </p>
          )}
        </div>
      </header>
      <p className="care-local-note">
        {t(
          "إرشادات عامة من مصادر زراعية؛ موعد الزراعة المحلي والصنف يحتاجان تأكيدًا، وملاءمة المدينة لا تضمن النجاح.",
        )}
      </p>
      <div className="care-sections">
        {sections.map(({ title, icon: Icon, value }, i) => (
          <section key={title} className="care-section">
            <h4>
              <Icon size={18} aria-hidden />
              <span>
                {i + 1}. {t(title)}
              </span>
            </h4>
            {value ? (
              <p>{careText(value)}</p>
            ) : (
              <ol>
                {guide.steps.map((step) => (
                  <li key={step.en}>{careText(step)}</li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
      <details className="care-evidence">
        <summary>{t("المصادر وما يحتاج تأكيدًا")}</summary>
        <p>
          {t(
            "المتاح: الإرشادات العامة أعلاه مستندة إلى المراجع المرتبطة. غير المحدد: أشهر الزراعة لكل مدينة سعودية، كمية الري وتكراره، وحدود رطوبة التربة. لم نُكمل أرقام العمق والمسافات إلا حيث ذُكرت في المرجع.",
          )}
        </p>
        <p>
          {t(
            "المراجع البريطانية والأمريكية تصف مناخها؛ لا تُنقل مواسمها تلقائيًا إلى مدينتك. الأسماء شائعة؛ تحقق من النوع والصنف قبل التطبيق.",
          )}
        </p>
        <ul>
          {guide.source_ids.map((id) => (
            <li key={id}>
              <a href={sources[id].url} target="_blank" rel="noreferrer">
                {sources[id].title}
              </a>{" "}
              · <bdi>{sources[id].context}</bdi>
            </li>
          ))}
        </ul>
        <p>
          {t("تاريخ مراجعة المراجع")}: <bdi>{care.reviewed_on}</bdi>
        </p>
      </details>
    </div>
  );
}

export function BeginnerSoilGuide() {
  return (
    <section
      className="beginner-soil panel"
      aria-label={t("التربة والري للمبتدئين")}
    >
      <h2>{t("التربة والري للمبتدئين")}</h2>
      <p>
        {t(
          "ابدأ باحتياجات نباتك، وافحص خليط الأصيص قبل الري؛ الجو وحده لا يخبرك برطوبة الجذور.",
        )}
      </p>
      <ul>
        <li>{t("تأكد من فتحات التصريف ولا تترك الأصيص واقفًا في الماء.")}</li>
        <li>
          {t(
            "راقب رطوبة الخليط والحرارة وحجم الوعاء؛ لا يوجد جدول أسبوعي يناسب كل النباتات.",
          )}
        </li>
        <li>
          {t(
            "ارجع إلى قسم الري والعناية في دليل النبات؛ بعض النباتات تحتاج رطوبة منتظمة وبعضها يحتاج جفاف الخليط بين الريات.",
          )}
        </li>
      </ul>
      <p className="footnote">
        {t(
          "الرطوبة الجوية ليست رطوبة التربة. هذا شرح للعناية المنزلية ولا يحدد كمية ماء محسوبة.",
        )}
      </p>
    </section>
  );
}
