import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#f5f0e8",
        surface: "#ede8df",
        "surface-2": "#e0dbd4",
        sub: "#d4ccc0",
        paper: "#1a1714",
        "paper-2": "#4a3f30",
        "paper-3": "#6b5f50",
        accent: "#c49a6c",
        "accent-dark": "#a07848",
      },
      fontFamily: {
        display: ["Oswald", "sans-serif"],
        data: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
