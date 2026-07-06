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

// Light mode — "Champagne" (black & gold, light surfaces)
const lightTokens = {
  // Brand — gold
  primary: '#A98521',
  primaryHover: '#8E6E16',
  primarySoft: '#F6EDCF',
  onPrimary: '#1A1505',
  primaryDark: '#7E6310',     // legacy gradient stop
  primaryDarker: '#5C480B',   // legacy
  primaryLight: '#F6EDCF',    // legacy → primarySoft

  // Status
  success: '#197A4B', successSoft: '#E6F4EC', successDark: '#14613B',
  warning: '#C77A18', warningSoft: '#FBF0DE',
  error: '#C0392F',   dangerSoft: '#F7E7E4',   errorDark: '#9E2B23',

  // Wastage accent (distinct from gold + kitchen-amber)
  wastage: '#B23A18', wastageSoft: '#F6E6DE', onWastage: '#FFFFFF',

  // Deliveries accent (stock in — green)
  delivery: '#197A4B', deliverySoft: '#E6F4EC', onDelivery: '#FFFFFF',

  // Text
  textPrimary: '#1B1813',
  textSecondary: '#6A6151',
  textMuted: '#9C927F',

  // Borders
  border: '#D9CDB0',        // the prominent line (legacy "border")
  borderLight: '#E8DFCB',   // the subtle line
  borderStrong: '#D9CDB0',

  // Surfaces
  bg: '#FAF7EF',
  surface: '#FFFFFF',
  surfaceSunken: '#F1EADB',
  bgPage: '#FAF7EF',   // legacy → bg
  bgCard: '#FFFFFF',   // legacy → surface
  bgLight: '#F1EADB',  // legacy → surfaceSunken

  // Header — black with gold lettering
  headerBg: '#14110A', headerText: '#E5C45C', headerSub: '#C2AC75', headerBtn: '#2A2417',

  // Elevation
  shadow: 'rgba(20,15,5,.12)',            // legacy shadow color
  shadowSm: '0 1px 2px rgba(20,15,5,.08)',
  shadowMd: '0 6px 16px rgba(20,15,5,.12)',

  disabled: '#D9CDB0',
};

// Dark mode — "Onyx & gold" (black surfaces, gold accents)
const darkTokens = {
  // Brand — bright gold
  primary: '#E3B341',
  primaryHover: '#EFC766',
  primarySoft: '#2A2110',
  onPrimary: '#191300',
  primaryDark: '#B98F22',
  primaryDarker: '#8C6C18',
  primaryLight: '#2A2110',

  // Status
  success: '#34B27B', successSoft: '#143025', successDark: '#2A8B5F',
  warning: '#E0A038', warningSoft: '#2E2614',
  error: '#F0716E',   dangerSoft: '#2A1719',   errorDark: '#D85C59',

  // Wastage accent (distinct from gold + kitchen-amber)
  wastage: '#FB7C42', wastageSoft: '#2A1B12', onWastage: '#1A0E06',

  // Deliveries accent (stock in — green)
  delivery: '#34B27B', deliverySoft: '#143025', onDelivery: '#0E2418',

  // Text
  textPrimary: '#F2EBD9',
  textSecondary: '#A89E86',
  textMuted: '#79715A',

  // Borders
  border: '#3B331F',
  borderLight: '#2B2618',
  borderStrong: '#3B331F',

  // Surfaces
  bg: '#0A0A0B',
  surface: '#18150F',
  surfaceSunken: '#100E09',
  bgPage: '#0A0A0B',
  bgCard: '#18150F',
  bgLight: '#100E09',

  // Header — black with gold lettering
  headerBg: '#0A0A0B', headerText: '#E3B341', headerSub: '#BCA771', headerBtn: '#241F12',

  // Elevation
  shadow: 'rgba(0,0,0,.5)',
  shadowSm: '0 1px 2px rgba(0,0,0,.40)',
  shadowMd: '0 8px 20px rgba(0,0,0,.55)',

  disabled: '#3B331F',
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
