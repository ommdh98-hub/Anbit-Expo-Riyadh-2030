import type { Plant } from "../lib/types";
import { display } from "../lib/i18n";
import GrowingGuide from "./growing-guide";
/** Original site profiles remain unchanged; care guidance is a separate cited layer. */
export default function PlantGuide({ plants }: { plants: Plant[] }) {
  return (
    <section aria-label={display("دليل النباتات الأصلي")}>
      <h2>{display("دليل النباتات الأصلي")}</h2>
      <p className="footnote">
        {display(
          "نباتات الموقع التجريبي الأصلية؛ إرشادات العناية عامة ومستقلة عن حسابات الري.",
        )}
      </p>
      <div className="plant-list">
        {plants.map((p) => (
          <article className="panel plant-card" key={p.id}>
            <span className="plant-mark" aria-hidden>
              ✦
            </span>
            <h3>{display(p.name)}</h3>
            <details>
              <summary>{display("العناية بالنبات")}</summary>
              <GrowingGuide plantId={p.id} name={p.name} />
            </details>
            <details>
              <summary>{display("مصدر ملف النبات")}</summary>
              <p>{display(p.notes)}</p>
              <p>{display(p.source.title)}</p>
              <p>{display(p.source.description)}</p>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
