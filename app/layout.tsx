import type { Metadata } from "next";
import { Pixelify_Sans, Nunito } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import HeaderGate from "@/components/HeaderGate";

const pixel = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-pixel",
  display: "swap",
});
const body = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Simford",
  description: "A cozy social sim — chat with the cast and build bonds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="day" className={`${pixel.variable} ${body.variable}`}>
      <body className="min-h-screen antialiased">
        <HeaderGate>
          <Header />
        </HeaderGate>
        <main className="mx-auto max-w-[1180px] px-[22px] py-7">{children}</main>
      </body>
    </html>
  );
}
