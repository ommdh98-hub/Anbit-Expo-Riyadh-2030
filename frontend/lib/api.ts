export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
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
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 1 }).format(n);
export const date = (v: string) =>
  new Date(v).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
