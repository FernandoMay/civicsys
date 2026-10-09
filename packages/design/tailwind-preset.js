import tokens from './tokens.json' assert { type: 'json' };

/**
 * CivicSys design tokens Tailwind preset
 * Maps brand tokens to Tailwind theme
 */
export default {
  theme: {
    extend: {
      colors: {
        // Core
        paper: tokens.color.paper.value,
        ink: tokens.color.ink.value,
        civic: tokens.color.civic.value,
        signal: tokens.color.signal.value,

        // Surface
        surface: tokens.color.surface.base.value,
        'surface-bright': tokens.color.surface.bright.value,
        'surface-container-lowest': tokens.color.surface['container-lowest'].value,
        'surface-container-low': tokens.color.surface['container-low'].value,
        'surface-container': tokens.color.surface.container.value,
        'surface-container-high': tokens.color.surface['container-high'].value,
        'surface-container-highest': tokens.color.surface['container-highest'].value,
        'surface-dim': tokens.color.surface.dim.value,
        'surface-variant': tokens.color.surface.variant.value,
        'surface-tint': tokens.color.surface.tint.value,

        // On surface
        'on-surface': tokens.color['on-surface'].value,
        'on-surface-variant': tokens.color['on-surface-variant'].value,
        outline: tokens.color.outline.value,
        'outline-variant': tokens.color['outline-variant'].value,

        // Primary
        primary: tokens.color.primary.value,
        'primary-container': tokens.color['primary-container'].value,
        'on-primary': tokens.color['on-primary'].value,
        'on-primary-container': tokens.color['on-primary-container'].value,

        // Secondary
        secondary: tokens.color.secondary.value,
        'secondary-container': tokens.color['secondary-container'].value,
        'on-secondary': tokens.color['on-secondary'].value,
        'on-secondary-container': tokens.color['on-secondary-container'].value,

        // Tertiary
        tertiary: tokens.color.tertiary.value,
        'tertiary-container': tokens.color['tertiary-container'].value,
        'on-tertiary': tokens.color['on-tertiary'].value,
        'on-tertiary-container': tokens.color['on-tertiary-container'].value,

        // Error
        error: tokens.color.error.value,
        'error-container': tokens.color['error-container'].value,
        'on-error': tokens.color['on-error'].value,
        'on-error-container': tokens.color['on-error-container'].value,

        // Inverse
        'inverse-surface': tokens.color['inverse-surface'].value,
        'inverse-on-surface': tokens.color['inverse-on-surface'].value,
        'inverse-primary': tokens.color['inverse-primary'].value,

        // Background
        background: tokens.color.surface.base.value,
      },
      spacing: {
        'space-xs': tokens.spacing['space-xs'].value,
        'space-sm': tokens.spacing['space-sm'].value,
        'space-md': tokens.spacing['space-md'].value,
        'space-lg': tokens.spacing['space-lg'].value,
        'space-xl': tokens.spacing['space-xl'].value,
        gutter: tokens.spacing.gutter.value,
        'gutter-sm': tokens.spacing['gutter-sm'].value,
        margin: tokens.spacing.margin.value,
        'margin-sm': tokens.spacing['margin-sm'].value,
      },
      borderRadius: {
        DEFAULT: tokens.borderRadius.default.value,
        lg: tokens.borderRadius.lg.value,
        xl: tokens.borderRadius.xl.value,
        full: tokens.borderRadius.full.value,
      },
      fontFamily: {
        'body-sm': tokens.typography['font-family'].body.value,
        'label-md': tokens.typography['font-family'].body.value,
        'headline-md': tokens.typography['font-family'].display.value,
        'headline-xl': tokens.typography['font-family'].display.value,
        'headline-lg': tokens.typography['font-family'].display.value,
        'headline-xl-mobile': tokens.typography['font-family'].display.value,
        'code-sm': tokens.typography['font-family'].mono.value,
        'code-md': tokens.typography['font-family'].mono.value,
        'body-lg': tokens.typography['font-family'].body.value,
        'body-md': tokens.typography['font-family'].body.value,
      },
      fontSize: {
        'body-sm': tokens.typography.scale['body-sm'].value.fontSize,
        'label-md': tokens.typography.scale['label-md'].value.fontSize,
        'headline-md': tokens.typography.scale['headline-md'].value.fontSize,
        'headline-xl': tokens.typography.scale['headline-xl'].value.fontSize,
        'headline-lg': tokens.typography.scale['headline-lg'].value.fontSize,
        'headline-xl-mobile': tokens.typography.scale['headline-xl-mobile'].value.fontSize,
        'code-sm': tokens.typography.scale['code-sm'].value.fontSize,
        'code-md': tokens.typography.scale['code-md'].value.fontSize,
        'body-lg': tokens.typography.scale['body-lg'].value.fontSize,
        'body-md': tokens.typography.scale['body-md'].value.fontSize,
      },
    },
  },
};