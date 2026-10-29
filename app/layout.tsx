import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KoreaLens — Point at Korea. Understand everything.",
  description:
    "Visual AI travel companion: tap an object in a photo of Korea and get an explanation in your language.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">{children}</div>
      </body>
    </html>
  );
}
