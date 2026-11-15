import type { Metadata } from "next";
import Script from "next/script";
import { ThemeSync } from "@/components/ThemeSync";
import { Atkinson_Hyperlegible, Inter, Literata } from "next/font/google";
import localFont from "next/font/local";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const serif = Literata({ variable: "--font-reader-serif", subsets: ["latin"] });
const hyper = Atkinson_Hyperlegible({ variable: "--font-reader-hyper", subsets: ["latin"], weight: ["400", "700"] });
// OpenDyslexic, for students who turn on the dyslexia font in Settings. Not preloaded: the
// browser only downloads it for people who use it.
// (Next requires these paths written out in full.)
const dyslexic = localFont({
  variable: "--font-dyslexic",
  preload: false,
  display: "swap",
  src: [
    { path: "../../node_modules/@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/opendyslexic/files/opendyslexic-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../../node_modules/@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../../node_modules/@fontsource/opendyslexic/files/opendyslexic-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
});

/** Has the signed-in user turned on the dyslexia font? (Never blocks the page if it can't tell.) */
async function wantsDyslexiaFont(): Promise<boolean> {
  try {
    return !!(await getCurrentUser())?.dyslexiaFont;
  } catch {
    return false;
  }
}

export const metadata: Metadata = {
  title: "Read Assist",
  description: "A reading coach that notices what you skipped, so you don't have to.",
};

// Runs before the first paint so the saved theme never "flashes".
const themeScript = `try{var t=localStorage.getItem('ra-theme');if(t&&t!=='system')document.documentElement.dataset.theme=t;}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const dyslexiaFont = await wantsDyslexiaFont();
  return (
    <html
      lang="en"
      className={`${ui.variable} ${serif.variable} ${hyper.variable} ${dyslexic.variable} h-full`}
      data-font={dyslexiaFont ? "dyslexic" : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* Next's way to run a small script before the page shows. A plain <script> here made
            React warn ("Encountered a script tag…") whenever it rendered the layout in the
            browser, e.g. on "not found" pages. */}
        <Script id="ra-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      {/* Extensions like Grammarly or custom-cursor tools add attributes to <body> before React
          hydrates. suppressHydrationWarning only ignores attribute mismatches on this one element,
          not its children. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
