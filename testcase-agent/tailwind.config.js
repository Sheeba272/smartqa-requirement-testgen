/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Agent 2 identity: deep teal/slate-green — build, execution,
        // output. Distinct from Agent 1's navy so the two agents are
        // visually distinguishable at a glance, while staying within the
        // same restrained, enterprise-grade family (shared ink neutrals,
        // same desaturation level, same typography).
        brand: {
          50:  "#EDF5F3",
          100: "#DAEAE6",
          200: "#B2D5CC",
          300: "#89C0B2",
          400: "#4F9D8A",
          500: "#2C7A67",
          600: "#236253",
          700: "#1B4B40",
          800: "#14382F",
          900: "#0D2620",
        },
        accent: {
          50:  "#F3F7F5",
          100: "#E3EDE9",
          400: "#7FA89B",
          500: "#5C8B7C",
          600: "#446B5F",
        },
        gold: {
          400: "#C9A24B",
          500: "#B08A35",
          600: "#8F6E27",
        },
        ink: {
          50:  "#F7F8FB",
          100: "#EEF0F6",
          200: "#DFE3ED",
          300: "#C5CBDB",
          400: "#9AA3BC",
          500: "#6E7894",
          600: "#525C78",
          700: "#3C4459",
          800: "#262B3D",
          900: "#161A28",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        display: ["Sora", "Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(36,25,102,0.04), 0 4px 16px -4px rgba(36,25,102,0.08)",
        "card-hover": "0 2px 8px rgba(36,25,102,0.06), 0 12px 32px -8px rgba(36,25,102,0.14)",
        glow: "0 0 0 1px rgba(109,90,230,0.08), 0 8px 24px -8px rgba(109,90,230,0.35)",
      },
      backgroundImage: {
        "grid-pattern": "radial-gradient(circle at 1px 1px, rgba(109,90,230,0.06) 1px, transparent 0)",
        "hero-gradient": "linear-gradient(135deg, #14382F 0%, #236253 55%, #446B5F 100%)",
        "gold-gradient": "linear-gradient(135deg, #F4C95D 0%, #E8B23D 100%)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.35s ease-out",
        "pulse-slow": "pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        slideUp: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-1000px 0" }, "100%": { backgroundPosition: "1000px 0" } },
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
