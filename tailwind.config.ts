import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx,js,jsx}",
    "./components/**/*.{ts,tsx,js,jsx}",
    "./pages/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        background:  "var(--background)",
        foreground:  "var(--foreground)",
        surface:     "var(--surface)",
        "surface-2": "var(--surface-2)",

        card:             "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover:             "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",

        primary:             "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        secondary:             "var(--secondary)",
        "secondary-foreground": "var(--secondary-foreground)",

        muted:             "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        faint:             "var(--faint)",

        accent:             "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",

        destructive:             "var(--destructive)",
        "destructive-foreground": "var(--destructive-foreground)",

        border:       "var(--border)",
        "border-soft": "var(--border-soft)",
        input:        "var(--input)",
        ring:         "var(--ring)",

        /* Logia brand */
        coral:       "var(--coral)",
        "coral-soft": "var(--coral-soft)",
        blush:       "var(--blush)",
        "blush-deep": "var(--blush-deep)",
        peach:       "var(--peach)",
        powder:      "var(--powder)",
        warm:        "var(--warm)",

        sidebar: {
          DEFAULT:    "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          accent:     "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border:     "var(--sidebar-border)",
        },
      },
      borderRadius: {
        sm:  "calc(var(--radius) - 6px)",
        md:  "calc(var(--radius) - 4px)",
        lg:  "var(--radius)",
        xl:  "var(--radius-large)",
        "2xl": "calc(var(--radius-large) + 6px)",
        "3xl": "calc(var(--radius-large) + 12px)",
      },
      fontFamily: {
        sans:  ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Instrument Serif", "Georgia", "serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        soft: "var(--shadow-soft)",
        lift: "var(--shadow-lift)",
      },
    },
  },
  plugins: [],
};

export default config;
