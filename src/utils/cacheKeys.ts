/**
 * Shared key builders for per-document sessionStorage/localStorage caches,
 * so every screen that reads or writes a document's cached AI analysis
 * (App, ThematicAnalysisScreen, SearchModal, ...) agrees on the same key.
 */

export function analysisCacheKey(title: string): string {
  return `marginalia_analysis_${title.replace(/[^a-zA-Z0-9]/g, '_')}`;
}
