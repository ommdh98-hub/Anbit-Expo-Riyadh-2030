import { currentLanguage } from "./i18n";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Anbit-Request": "app",
      ...options.headers,
    },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401 && path !== "/auth/login") {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("anbit-session-expired"));
  }
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: "تعذر الاتصال بالخادم" }));
    const message = Array.isArray(body.detail)
      ? body.detail
          .map((e: { msg: string }) => e.msg.replace("Value error, ", ""))
          .join("، ")
      : body.detail;
    throw new Error(message || "تعذر إكمال العملية");
  }
  return response.json();
}
export const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
export const number = (n: number) =>
  new Intl.NumberFormat(currentLanguage() === "ar" ? "ar-SA" : "en-US", {
    maximumFractionDigits: 1,
  }).format(n);
export const date = (v: string) =>
  new Date(v).toLocaleString(currentLanguage() === "ar" ? "ar-SA" : "en-GB", {
    timeZone: "Asia/Riyadh",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
