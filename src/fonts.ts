import localFont from "next/font/local";

export const geistSans = localFont({
  variable: "--font-geist-sans",
  display: "swap",
  src: [
    { path: "../public/fonts/geist-latin.woff2" },
    { path: "../public/fonts/geist-latin-ext.woff2" },
    { path: "../public/fonts/geist-cyrillic.woff2" },
  ],
});

export const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [
    { path: "../public/fonts/geist-mono-latin.woff2" },
    { path: "../public/fonts/geist-mono-latin-ext.woff2" },
    { path: "../public/fonts/geist-mono-cyrillic.woff2" },
  ],
});

export const poppins = localFont({
  display: "swap",
  src: [
    { path: "../public/fonts/poppins-400-latin.woff2",     weight: "400", style: "normal" },
    { path: "../public/fonts/poppins-400-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/poppins-600-latin.woff2",     weight: "600", style: "normal" },
    { path: "../public/fonts/poppins-600-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/poppins-700-latin.woff2",     weight: "700", style: "normal" },
    { path: "../public/fonts/poppins-700-latin-ext.woff2", weight: "700", style: "normal" },
  ],
});
