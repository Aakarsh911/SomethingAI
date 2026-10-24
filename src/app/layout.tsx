import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeScript } from "@/components/theme/theme-script";
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
  title: {
    default: "SomethingAI — Automations, described in plain English",
    template: "%s · SomethingAI",
  },
  description:
    "Describe an automation in plain English. SomethingAI compiles it into an editable workflow across Gmail, GitHub, Slack and 800+ tools.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider appearance={{ theme: shadcn }}>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full max-w-[100vw] overflow-x-clip`}
      >
        <head>
          <ThemeScript />
        </head>
        <body className="flex min-h-full max-w-[100vw] flex-col overflow-x-clip bg-background text-foreground antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
