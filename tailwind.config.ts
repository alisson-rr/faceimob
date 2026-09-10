import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Todo token de `src/index.css` precisa de espelho aqui — um token sem espelho
 * compila zero regras e a classe some em silencio (era o achado T01: `success`
 * e `warning` existiam no CSS, nao aqui, e ~40 classes nao pintavam nada).
 * Regra: mexeu em `:root`/`.light`, mexa em `colors`.
 */
const withForeground = (name: string) => ({
  DEFAULT: `hsl(var(--${name}))`,
  foreground: `hsl(var(--${name}-foreground))`,
});

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["'DM Sans Variable'", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["'Bricolage Grotesque Variable'", "system-ui", "Segoe UI", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: withForeground("primary"),
        secondary: withForeground("secondary"),
        destructive: withForeground("destructive"),
        muted: withForeground("muted"),
        accent: withForeground("accent"),
        popover: withForeground("popover"),
        card: withForeground("card"),
        success: withForeground("success"),
        warning: withForeground("warning"),
        info: withForeground("info"),
        highlight: withForeground("highlight"),
        gold: withForeground("gold"),
        silver: withForeground("silver"),
        bronze: withForeground("bronze"),
        brand: {
          blue: "hsl(var(--brand-blue))",
          "blue-light": "hsl(var(--brand-blue-light))",
          mint: "hsl(var(--brand-mint))",
          yellow: "hsl(var(--brand-yellow))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        sm: "calc(var(--radius) - 0.5rem)",
        md: "calc(var(--radius) - 0.25rem)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 0.25rem)",
        "2xl": "calc(var(--radius) + 0.5rem)",
        "3xl": "calc(var(--radius) + 1rem)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(.22, 1, .36, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(30px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-10px) rotate(2deg)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px -5px hsl(var(--highlight) / 0.3)" },
          "50%": { boxShadow: "0 0 40px -5px hsl(var(--highlight) / 0.6)" },
        },
        "bg-slide": {
          "0%": { opacity: "1" },
          "25%": { opacity: "1" },
          "33%": { opacity: "0" },
          "92%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.4s cubic-bezier(.22,1,.36,1) forwards",
        "slide-in-right": "slide-in-right 0.4s cubic-bezier(.22,1,.36,1) forwards",
        float: "float 7s ease-in-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
