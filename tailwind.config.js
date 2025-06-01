/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#005131', // Management Tools Green
        secondary: '#a57626', // Management Tools Gold
      },
    },
  },
  plugins: [],
}; 