import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight } from "lucide-react";
import BackgroundPaths from "@/components/kokonutui/background-paths";
import { Brand } from "@/components/brand";
import { ClosingCta } from "@/components/landing/closing";
import { HeroCta } from "@/components/landing/hero-cta";
import { HeroWord } from "@/components/landing/hero-word";
import { ProductSections } from "@/components/landing/product-sections";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/workflows");

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-transparent bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
          <Brand />
          <nav className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
            <a href="#how" className="rounded-md px-3 py-1.5 transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="rounded-md px-3 py-1.5 transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#integrations" className="rounded-md px-3 py-1.5 transition-colors hover:text-foreground">
              Integrations
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <SignInButton mode="modal">
              <button
                type="button"
                className="hidden h-8 cursor-pointer rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex sm:items-center"
              >
                Sign in
              </button>
            </SignInButton>
            <Link
              href="/sign-up"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/85"
            >
              Get started
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <BackgroundPaths
          className="min-h-[100dvh] bg-transparent pt-16 text-foreground dark:bg-transparent"
          count={36}
          speed={0.6}
          chromatic
        >
          <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
            <a
              href="#integrations"
              className="group mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-background/70 py-1 pr-3 pl-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground"
            >
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-brand">New</span>
              Edit any workflow by just asking
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </a>

            <h1 className="text-[clamp(2.6rem,6.5vw,5rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-foreground">
              Automate <HeroWord />
              <br />
              <span className="text-muted-foreground">in plain English.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              Describe the busywork. SomethingAI compiles it into a workflow you can
              see, edit, test and schedule — across the tools you already use.
            </p>

            <HeroCta />

            <p className="mt-6 text-xs text-muted-foreground">
              No credit card. Nothing runs until you switch it on.
            </p>
          </div>
        </BackgroundPaths>

        <ProductSections />
        <ClosingCta />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <Brand />
          <p>© {new Date().getFullYear()} SomethingAI. Automations, described.</p>
        </div>
      </footer>
    </div>
  );
}
