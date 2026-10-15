"use client";
import { useLandscape } from "./context";
import { useCopy } from "./copy";

export function LoadingState({ loading, error }: { loading: boolean; error: string }) {
  const c = useCopy();
  const { refresh } = useLandscape();
  return (
    <div className="lx-screen lx-state" aria-busy={loading}>
      {loading ? (
        <p role="status">{c.t("نجهّز المناطق…", "Preparing zones…")}</p>
      ) : (
        <>
          <p role="alert">{error ? c.show(error) : c.t("لا توجد مناطق بعد.", "No zones yet.")}</p>
          <button type="button" className="lx-secondary" onClick={() => void refresh()}>
            {c.t("إعادة المحاولة", "Try again")}
          </button>
        </>
      )}
    </div>
  );
}
