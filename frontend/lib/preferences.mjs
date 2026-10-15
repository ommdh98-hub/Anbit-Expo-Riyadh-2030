const KEY = "anbit-preferences";
export const defaultPreferences = "ar:light";
export function parsePreferences(value) {
  try {
    const p = JSON.parse(value || "{}");
    return `${p.language === "en" ? "en" : "ar"}:${p.theme === "dark" ? "dark" : "light"}`;
  } catch {
    return defaultPreferences;
  }
}
export function getPreferences() {
  if (typeof window === "undefined") return defaultPreferences;
  try {
    return parsePreferences(window.localStorage.getItem(KEY));
  } catch {
    return `${document.documentElement.lang === "en" ? "en" : "ar"}:${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}`;
  }
}
export function applyPreferences(snapshot) {
  const [language, theme] = snapshot.split(":");
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme = theme;
}
export function savePreferences(language, theme) {
  const snapshot = `${language === "en" ? "en" : "ar"}:${theme === "dark" ? "dark" : "light"}`;
  applyPreferences(snapshot);
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ language, theme }));
  } catch {
    /* Storage may be unavailable. */
  }
  window.dispatchEvent(new Event("anbit-preferences"));
}
export function subscribePreferences(listener) {
  const update = () => {
    applyPreferences(getPreferences());
    listener();
  };
  window.addEventListener("storage", update);
  window.addEventListener("anbit-preferences", listener);
  return () => {
    window.removeEventListener("storage", update);
    window.removeEventListener("anbit-preferences", listener);
  };
}
// Runs before first paint. Stored values are validated, never inserted as HTML.
export const preferenceBootstrap = `(()=>{let p={};try{p=JSON.parse(localStorage.getItem('anbit-preferences')||'{}')||{}}catch{}const h=document.documentElement;h.lang=p.language==='en'?'en':'ar';h.dir=h.lang==='ar'?'rtl':'ltr';h.dataset.theme=p.theme==='dark'?'dark':'light';if(h.lang==='en')h.dataset.localizing='true'})()`;
