// src/app/layout.tsx
// Root layout: Vietnamese document shell, global styles and page metadata.
// Authentication is enforced per page (requirePageUser), not here, because /login shares this layout.

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { vi } from "@/i18n/vi";
import "./globals.css";

export const metadata: Metadata = {
  title: vi.common.appName,
  // Internal tool: keep it out of search engines even if a URL leaks (BR-10).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Root layout component.
 *
 * @param props.children - The page being rendered.
 * @returns The HTML document shell.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-gray-50 text-base text-gray-900 antialiased">{children}</body>
    </html>
  );
}
