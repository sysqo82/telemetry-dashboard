/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {
      colors: {
        panel: '#111318',
        line: '#242832',
      },
    },
  },
  plugins: [],
};
