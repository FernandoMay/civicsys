const preset = require('@civicsys/design/tailwind-preset').default;

module.exports = {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};