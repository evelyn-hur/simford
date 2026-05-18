import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Stanford Cardinal — used sparingly for accents only.
        cardinal: "#8C1515",
      },
    },
  },
  plugins: [],
};

export default config;
