/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}',
    './stories/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      // primary, secondary and success come from app/styles/tailwind.css's @theme inline block,
      // which maps them onto Spoonjoy's palette for Ouro UI.
      colors: {
        danger: {
          DEFAULT: '#dc3545',
          600: '#c82333',
        },
      },
    },
  },
  plugins: [],
};
