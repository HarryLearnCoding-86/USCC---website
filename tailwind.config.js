/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tournament branding colours are applied via CSS variables set per tournament.
        // See: src/app/tournaments/[id]/layout.tsx for variable injection.
        brand: {
          primary: "var(--brand-primary, #1d4ed8)",
          secondary: "var(--brand-secondary, #1e40af)",
        },
      },
    },
  },
  plugins: [],
};

