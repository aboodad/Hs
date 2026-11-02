import type { Config } from 'tailwindcss'

// الهوية البصرية: بني (القهوة/العود) + ذهبي + كريمي
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // بني عميق — الأزرار الرئيسية والقائمة الجانبية
        brand: {
          50: '#faf5ee', 100: '#f1e6d6', 200: '#e2cdb0', 300: '#cdac80', 400: '#b48a58',
          500: '#98693c', 600: '#7a5230', 700: '#5e3d25', 800: '#46301e', 900: '#2e2014', 950: '#1d130c',
        },
        // ذهبي — اللمسات والتحديد والتمييز
        gold: {
          50: '#fcf8e9', 100: '#f8efc6', 200: '#f1de91', 300: '#e8c960', 400: '#dcb340',
          500: '#c9a24b', 600: '#a9842f', 700: '#856623', 800: '#68501f', 900: '#57431d',
        },
        // كريمي — الخلفيات والبطاقات
        cream: {
          50: '#fffdf8', 100: '#fbf6ea', 200: '#f5ecd7', 300: '#ecdfc2', 400: '#dccaa2',
        },
      },
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'Tajawal', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'] },
      boxShadow: {
        soft: '0 1px 2px rgba(70,48,30,.05), 0 10px 28px -14px rgba(70,48,30,.18)',
        gold: '0 6px 18px -6px rgba(169,132,47,.55)',
      },
      borderRadius: { '2xl': '1.1rem' },
    },
  },
  plugins: [],
} satisfies Config
