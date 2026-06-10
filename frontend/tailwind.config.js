/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // darkMode: hace que las variantes `dark:` (ej. dark:bg-slate-800) respondan
  // a los toggles de la app y NO al tema del sistema operativo (que era el
  // comportamiento por defecto y causaba que componentes nuevos se vieran mal).
  // Se activan cuando el elemento es descendiente de:
  //   - .admin-dark            → panel de administración (toggle 🌙/☀️)
  //   - [data-theme="oscuro"]  → tienda pública (toggle de la navbar)
  // Así se puede usar el patrón estándar "clase-clara dark:clase-oscura" en
  // cualquier componente nuevo y funciona solo, sin tener que mapear cada clase
  // a mano en index.css.
  darkMode: ["variant", [
    ".admin-dark &",
    '[data-theme="oscuro"] &',
  ]],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "#eef1f4",
          100: "#d3dce4",
          200: "#b2c3d0",
          300: "#8ca6b8",
          400: "#66899f",
          500: "#4d6e83",
          600: "#32485c",   // rgb(50, 72, 92)
          700: "#273d4d",
          800: "#1a2a35",
        },
        secondary: {
          50:  "#e6ffe6",
          100: "#b8f5b8",
          200: "#85e685",
          300: "#4dcc4d",
          400: "#1ab31a",
          500: "#00aa00",
          600: "#009900",   // rgb(0, 153, 0)
          700: "#007500",
          800: "#004d00",
        },
        dark: {
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
