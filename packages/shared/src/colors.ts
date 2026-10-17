import type { Hazard, RiskLevel } from './risk';

/**
 * Colour tokens. Every risk level is also paired with an icon and a text label
 * so the UI never relies on colour alone (colour-blind friendly).
 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  none: '#9CA3AF',
  low: '#16A34A',
  moderate: '#CA8A04',
  high: '#EA580C',
  severe: '#B91C1C',
};

export const RISK_ICONS: Record<RiskLevel, string> = {
  none: '○',
  low: '●',
  moderate: '▲',
  high: '◆',
  severe: '⬢',
};

export const RISK_LABELS: Record<RiskLevel, { en: string; ms: string }> = {
  none: { en: 'No risk', ms: 'Tiada risiko' },
  low: { en: 'Low', ms: 'Rendah' },
  moderate: { en: 'Moderate', ms: 'Sederhana' },
  high: { en: 'High', ms: 'Tinggi' },
  severe: { en: 'Severe', ms: 'Teruk' },
};

/** Distinct palettes per hazard map (Section 6.1). Scale is ordered low → severe. */
export const HAZARD_PALETTES: Record<Hazard, { base: string; scale: string[]; icon: string }> = {
  haze: {
    base: '#6B7280',
    scale: ['#D1D5DB', '#F59E0B', '#B45309', '#7C3AED', '#4C1D95'],
    icon: '🌫️',
  },
  flood: {
    base: '#0E7490',
    scale: ['#A5F3FC', '#22D3EE', '#0891B2', '#1D4ED8', '#1E3A8A'],
    icon: '🌊',
  },
  disease: {
    base: '#BE185D',
    scale: ['#FCE7F3', '#F9A8D4', '#EC4899', '#DC2626', '#7F1D1D'],
    icon: '🦠',
  },
};
