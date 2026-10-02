import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "mutherboard Sales Trainer",
  description: "Practice sales calls with an AI prospect and get scored coaching.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
