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

// Light mode — "Steel" (cobalt blue on cool grey, light surfaces)
const lightTokens = {
  // Brand — cobalt steel blue
  primary: '#2757C4',
  primaryHover: '#1E46A3',
  primarySoft: '#E4EBFA',
  onPrimary: '#FFFFFF',
  primaryDark: '#1B3E90',     // legacy gradient stop
  primaryDarker: '#142E6C',   // legacy
  primaryLight: '#E4EBFA',    // legacy → primarySoft

  // Status
  success: '#197A4B', successSoft: '#E6F4EC', successDark: '#14613B',
  warning: '#C77A18', warningSoft: '#FBF0DE',
  error: '#C0392F',   dangerSoft: '#F7E7E4',   errorDark: '#9E2B23',

  // Wastage accent (distinct from blue + kitchen-amber)
  wastage: '#B23A18', wastageSoft: '#F6E6DE', onWastage: '#FFFFFF',

  // Deliveries accent (stock in — green)
  delivery: '#197A4B', deliverySoft: '#E6F4EC', onDelivery: '#FFFFFF',

  // Text
  textPrimary: '#161B26',
  textSecondary: '#5B6472',
  textMuted: '#8B94A5',

  // Borders
  border: '#C7CFDB',        // the prominent line (legacy "border")
  borderLight: '#DFE4EC',   // the subtle line
  borderStrong: '#C7CFDB',

  // Surfaces
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceSunken: '#EAEEF3',
  bgPage: '#F5F7FA',   // legacy → bg
  bgCard: '#FFFFFF',   // legacy → surface
  bgLight: '#EAEEF3',  // legacy → surfaceSunken

  // Header — rich navy with white lettering
  headerBg: '#1F3D73', headerText: '#FFFFFF', headerSub: '#C5CFE2', headerBtn: '#30508F',

  // Elevation
  shadow: 'rgba(16,24,40,.12)',            // legacy shadow color
  shadowSm: '0 1px 2px rgba(16,24,40,.08)',
  shadowMd: '0 6px 16px rgba(16,24,40,.12)',

  disabled: '#C7CFDB',
};

// Dark mode — "Gunmetal" (near-black slate surfaces, bright steel accents)
const darkTokens = {
  // Brand — bright steel blue
  primary: '#6C9EF8',
  primaryHover: '#8FB4FA',
  primarySoft: '#18233A',
  onPrimary: '#071125',
  primaryDark: '#4A80E0',
  primaryDarker: '#3564BE',
  primaryLight: '#18233A',

  // Status
  success: '#34B27B', successSoft: '#143025', successDark: '#2A8B5F',
  warning: '#E0A038', warningSoft: '#2E2614',
  error: '#F0716E',   dangerSoft: '#2A1719',   errorDark: '#D85C59',

  // Wastage accent (distinct from blue + kitchen-amber)
  wastage: '#FB7C42', wastageSoft: '#2A1B12', onWastage: '#1A0E06',

  // Deliveries accent (stock in — green)
  delivery: '#34B27B', deliverySoft: '#143025', onDelivery: '#0E2418',

  // Text
  textPrimary: '#E7EBF3',
  textSecondary: '#99A3B6',
  textMuted: '#667082',

  // Borders
  border: '#313B4E',
  borderLight: '#232B39',
  borderStrong: '#313B4E',

  // Surfaces
  bg: '#0B0D12',
  surface: '#12161F',
  surfaceSunken: '#0E1117',
  bgPage: '#0B0D12',
  bgCard: '#12161F',
  bgLight: '#0E1117',

  // Header — near-black slate with white lettering
  headerBg: '#0B0D12', headerText: '#FFFFFF', headerSub: '#99A3B6', headerBtn: '#182236',

  // Elevation
  shadow: 'rgba(0,0,0,.5)',
  shadowSm: '0 1px 2px rgba(0,0,0,.40)',
  shadowMd: '0 8px 20px rgba(0,0,0,.55)',

  disabled: '#313B4E',
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
