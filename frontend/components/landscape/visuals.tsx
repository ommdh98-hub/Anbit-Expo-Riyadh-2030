"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Badge, Freshness, RingModel } from "./data";
import { useCopy } from "./copy";

// Soft, blurred color fields and one leaf / drop silhouette. Decorative only.
export function OrganicField({ tone = "calm" }: { tone?: "calm" | "water" }) {
  return (
    <div className={`lx-field lx-field-${tone}`} aria-hidden="true">
      <span className="lx-blob lx-blob-a" />
      <span className="lx-blob lx-blob-b" />
      <svg className="lx-leaf" viewBox="0 0 200 200">
        <path d="M100 18C150 52 172 98 156 140c-12 32-44 46-56 44C88 186 56 172 44 140 28 98 50 52 100 18Z" />
        <path className="lx-leaf-vein" d="M100 40v140" />
      </svg>
    </div>
  );
}

export function SoilLayers() {
  return (
    <svg className="lx-soil" viewBox="0 0 320 60" aria-hidden="true" preserveAspectRatio="none">
      <path d="M0 18C60 8 110 26 170 16s110-6 150 2V60H0Z" />
      <path d="M0 34c70-8 120 10 180 2s100-4 140 2V60H0Z" />
      <path d="M0 48c80-6 140 6 200 0s90-2 120 2V60H0Z" />
    </svg>
  );
}

export function MoistureRing({ model, size = 232 }: { model: RingModel; size?: number }) {
  const c = useCopy();
  const stroke = 18;
  const r = (size - stroke) / 2 - 4;
  const length = 2 * Math.PI * r;
  const empty = model.state === "empty";
  const label = empty
    ? c.t("لا توجد قراءة بعد", "No reading yet")
    : c.t(
        `الرطوبة ${model.percent}% من هدف ${model.targetPercent}%`,
        `Moisture ${model.percent}% of a ${model.targetPercent}% target`,
      );
  return (
    <figure className={`lx-ring lx-ring-${model.state}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="lx-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        {!empty && (
          <circle
            className="lx-ring-fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={length}
            strokeDashoffset={length * (1 - model.fill)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <figcaption>
        {empty ? (
          <span className="lx-ring-empty">{c.t("ابدأ بقراءة واحدة", "Start with one reading")}</span>
        ) : (
          <>
            <strong>
              {c.num(model.percent ?? 0)}
              <small>%</small>
            </strong>
            <span>{c.t(`الهدف ${c.num(model.targetPercent)}%`, `Target ${model.targetPercent}%`)}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

export function SourceBadge({ badge, fresh }: { badge: Badge | null; fresh?: Freshness | null }) {
  const c = useCopy();
  if (!badge) return null;
  const text =
    badge.kind === "measured"
      ? badge.simulated
        ? c.t("قراءة محاكاة", "Simulated reading")
        : c.t("مقاسة", "Measured")
      : badge.kind === "estimated"
        ? c.t("تقدير", "Estimate")
        : c.t("افتراض عرض", "Demo assumption");
  return (
    <span className={`lx-badge lx-badge-${badge.kind}`}>
      <i aria-hidden="true" />
      {text}
      {fresh && (
        <em className={fresh.stale ? "stale" : ""}>· {c.ago(fresh.value, fresh.unit)}</em>
      )}
    </span>
  );
}

// Native <dialog>: focus is trapped and Escape closes it.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const c = useCopy();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="lx-sheet"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="lx-sheet-body">
          <header>
            <h2 id={id}>{title}</h2>
            <button type="button" className="lx-icon" onClick={onClose} aria-label={c.t("إغلاق", "Close")}>
              <X size={20} />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
