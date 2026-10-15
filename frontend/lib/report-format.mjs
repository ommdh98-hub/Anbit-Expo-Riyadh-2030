// Formatting only: conversion preserves up to 0.001 L, with no one-decimal rounding.
export function formatReportVolume(litres, language = "ar") {
  const locale = language === "ar" ? "ar-SA" : "en-US";
  const format = (value, digits) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
      value,
    );
  return { litres: format(litres, 3), cubicMetres: format(litres / 1000, 6) };
}
