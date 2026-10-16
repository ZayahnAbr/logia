import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import "./refresh.css";
import "./polish.css";
import "./flashcards.css";
import { Toaster } from "@/components/Toaster";
import { RoomProvider } from "@/components/RoomProvider";
import { RoomDock } from "@/components/RoomDock";
import { MusicProvider } from "@/components/MusicProvider";

// Self-hosted via next/font: fonts are fetched and inlined at build time (no runtime request
// to Google Fonts, no render-blocking <link>, no extra round trip), with font-display: swap
// and automatic fallback-metric matching to avoid layout shift while the font loads.
const sans = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: "400",
  variable: "--font-serif",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f2f0" }, { media: "(prefers-color-scheme: dark)", color: "#141211" }],
};

export const metadata: Metadata = {
  title: "Logia: notes, flashcards and study rooms",
  description: "Notes, flashcards, lectures, mind maps and smart study tools in one private workspace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${sans.variable} ${instrumentSerif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("logia.sidebar")==="hidden")document.documentElement.dataset.sidebar="hidden";if(localStorage.getItem("logia.theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}` }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <RoomProvider>
          <MusicProvider>
            {children}
            <RoomDock />
          </MusicProvider>
        </RoomProvider>
        <Toaster />
      </body>
    </html>
  );
}
