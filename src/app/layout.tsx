import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SomethingAI",
  description:
    "Describe an automation in plain English. SomethingAI compiles it into an editable MCP workflow graph.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full max-w-[100vw] overflow-x-hidden scheme-light-dark`}
      >
        <body className="flex min-h-full max-w-[100vw] flex-col overflow-x-hidden bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-[#ededed]">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
