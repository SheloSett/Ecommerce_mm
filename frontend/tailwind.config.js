/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
