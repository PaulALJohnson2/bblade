/**
 * Theme Configuration — "Cobalt"
 *
 * JS mirror of the design tokens in index.css, for use in inline styles.
 * Values come from the BBlade Design System (design/BBlade-Design-System.html).
 *
 * Keep this in sync with index.css:
 *  - Canonical names (surface, primary, onPrimary, …) match the CSS tokens.
 *  - Legacy names (bgCard, bgLight, bgPage, error, …) are kept so existing
 *    inline styles keep working; they alias the canonical values.
 *
 * Unlike CSS, inline styles can't read [data-theme], so colors are resolved
 * per-mode here via getThemeColors(isDark).
 */

// Light mode
const lightTokens = {
  // Brand
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primarySoft: '#EAF0FE',
  onPrimary: '#FFFFFF',
  primaryDark: '#1E40AF',     // legacy gradient stop
  primaryDarker: '#1E3A8A',   // legacy
  primaryLight: '#EAF0FE',    // legacy → primarySoft

  // Status
  success: '#197A4B', successSoft: '#E6F4EC', successDark: '#14613B',
  warning: '#C77A18', warningSoft: '#FBF0DE',
  error: '#DC3B40',   dangerSoft: '#FCEAEA',   errorDark: '#C32F34',

  // Wastage accent (distinct from primary-blue and kitchen-amber)
  wastage: '#C2410C', wastageSoft: '#FBEDE5', onWastage: '#FFFFFF',

  // Text
  textPrimary: '#131A24',
  textSecondary: '#5A6675',
  textMuted: '#8A93A3',

  // Borders
  border: '#CFD6E0',        // the prominent line (legacy "border")
  borderLight: '#E2E7EE',   // the subtle line
  borderStrong: '#CFD6E0',

  // Surfaces
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceSunken: '#EEF1F6',
  bgPage: '#F5F7FA',   // legacy → bg
  bgCard: '#FFFFFF',   // legacy → surface
  bgLight: '#EEF1F6',  // legacy → surfaceSunken

  // Header
  headerBg: '#2563EB', headerText: '#FFFFFF', headerSub: '#C8D8FB', headerBtn: '#3D77EE',

  // Elevation
  shadow: 'rgba(16,24,40,.10)',           // legacy shadow color
  shadowSm: '0 1px 2px rgba(16,24,40,.06)',
  shadowMd: '0 6px 16px rgba(16,24,40,.10)',

  disabled: '#CFD6E0',
};

// Dark mode
const darkTokens = {
  // Brand
  primary: '#4F8BFF',
  primaryHover: '#6B9DFF',
  primarySoft: '#1B2740',
  onPrimary: '#08152E',
  primaryDark: '#27488F',
  primaryDarker: '#1B3A82',
  primaryLight: '#1B2740',

  // Status
  success: '#34B27B', successSoft: '#143025', successDark: '#2A8B5F',
  warning: '#E0A038', warningSoft: '#2E2614',
  error: '#F0716E',   dangerSoft: '#2A1719',   errorDark: '#D85C59',

  // Wastage accent (distinct from primary-blue and kitchen-amber)
  wastage: '#FB7C42', wastageSoft: '#2A1B12', onWastage: '#1A0E06',

  // Text
  textPrimary: '#EAEEF5',
  textSecondary: '#93A0B2',
  textMuted: '#6B7686',

  // Borders
  border: '#36425A',
  borderLight: '#283242',
  borderStrong: '#36425A',

  // Surfaces
  bg: '#0C1016',
  surface: '#161C26',
  surfaceSunken: '#11161E',
  bgPage: '#0C1016',
  bgCard: '#161C26',
  bgLight: '#11161E',

  // Header
  headerBg: '#1B3A82', headerText: '#FFFFFF', headerSub: '#A7C2F5', headerBtn: '#27488F',

  // Elevation
  shadow: 'rgba(0,0,0,.45)',
  shadowSm: '0 1px 2px rgba(0,0,0,.30)',
  shadowMd: '0 8px 20px rgba(0,0,0,.45)',

  disabled: '#36425A',
};

// Default theme (light mode) for backwards compatibility
export const theme = { ...lightTokens };

// Get theme colors based on dark mode state
export function getThemeColors(isDark = false) {
  return isDark ? darkTokens : lightTokens;
}

// Gradient helper (auth / loading screens — always the light cobalt gradient)
export const gradients = {
  primary: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.primaryDark} 100%)`,
};

export default theme;
