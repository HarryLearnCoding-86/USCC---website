// src/app/not-found.tsx
// 404 page with a Vietnamese message.

import Link from "next/link";
import { vi } from "@/i18n/vi";

/**
 * Not-found page.
 *
 * @returns A short message and a link home.
 */
export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{vi.errors.notFound}</h1>
      <Link href="/" className="mt-4 inline-block text-brand-primary underline">
        {vi.errors.goHome}
      </Link>
    </main>
  );
}
