// Print only the requested report, preserving disclosure state after printing/cancel.
export function printExecutiveReport(
  root,
  scope = "executive",
  printWindow = window,
) {
  const previousScope = root.dataset.printScope;
  root.dataset.printScope = scope;
  const selector =
    scope === "technical"
      ? ".report-technical-appendix:not([open])"
      : "[data-print-expand='main']:not([open])";
  const closed = Array.from(root.querySelectorAll(selector));
  closed.forEach((detail) => {
    detail.open = true;
  });
  const restore = () => {
    closed.forEach((detail) => {
      detail.open = false;
    });
    if (previousScope) root.dataset.printScope = previousScope;
    else delete root.dataset.printScope;
    printWindow.removeEventListener("afterprint", restore);
  };
  printWindow.addEventListener("afterprint", restore, { once: true });
  try {
    printWindow.print();
  } catch (error) {
    restore();
    throw error;
  }
}
