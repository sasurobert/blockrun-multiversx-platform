/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mvx: {
          blue: "#1b46f5",
          dark: "#0b0e14",
          surface: "#121721",
          border: "#1f2937",
          cyan: "#23f7dd",
        }
      }
    },
  },
  plugins: [],
}
