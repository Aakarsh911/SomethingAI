import Image from "next/image";
import Link from "next/link";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-neutral-50 dark:bg-black">
      <nav className="flex w-full max-w-[800px] items-center justify-end gap-3 px-[60px] pt-4">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="h-9 cursor-pointer rounded-full border border-[#ebebeb] bg-transparent px-4 text-sm font-medium text-black transition-all duration-200 hover:bg-[#f2f2f2] dark:border-[#1a1a1a] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="h-9 cursor-pointer rounded-full border border-transparent bg-black px-4 text-sm font-medium text-neutral-50 transition-all duration-200 hover:bg-[#383838] dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]">
              Sign up
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <Link
            className="h-9 cursor-pointer rounded-full border border-[#ebebeb] bg-transparent px-4 text-sm leading-9 font-medium text-black transition-all duration-200 hover:bg-[#f2f2f2] dark:border-[#1a1a1a] dark:text-[#ededed] dark:hover:bg-[#1a1a1a]"
            href="/settings/integrations"
          >
            Integrations
          </Link>
          <UserButton />
        </Show>
      </nav>
      <main className="flex w-full max-w-[800px] flex-1 flex-col items-start justify-between bg-white px-6 py-12 min-[600px]:px-[60px] min-[600px]:py-[120px] dark:bg-black">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-start gap-4 text-left min-[600px]:gap-6">
          <h1 className="max-w-[320px] text-[32px] leading-10 font-semibold tracking-[-1.92px] text-balance text-black min-[600px]:text-[40px] min-[600px]:leading-[48px] min-[600px]:tracking-[-2.4px] dark:text-[#ededed]">
            To get started, edit the{" "}
            <code className="rounded-md bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-[0.4em] py-[0.1em] font-mono text-[0.9em]">
              page.tsx
            </code>{" "}
            file.
          </h1>
          <p className="max-w-[440px] text-lg leading-8 text-balance text-[#666] dark:text-[#999]">
            Looking for a starting point or more instructions? Head over to{" "}
            <a
              className="font-medium text-black dark:text-[#ededed]"
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Templates
            </a>{" "}
            or the{" "}
            <a
              className="font-medium text-black dark:text-[#ededed]"
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learning
            </a>{" "}
            center.
          </p>
        </div>
        <div className="flex w-full max-w-[440px] flex-row gap-4 text-sm">
          <a
            className="flex h-10 w-fit cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-black px-4 font-medium text-neutral-50 transition-all duration-200 hover:border-transparent hover:bg-[#383838] dark:bg-[#ededed] dark:text-black dark:hover:bg-[#ccc]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={14}
            />
            Deploy Now
          </a>
          <a
            className="flex h-10 w-fit cursor-pointer items-center justify-center rounded-full border border-[#ebebeb] px-4 font-medium transition-all duration-200 hover:border-transparent hover:bg-[#f2f2f2] dark:border-[#1a1a1a] dark:hover:bg-[#1a1a1a]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}
