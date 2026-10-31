// next.config.mjs
// Next.js configuration. "standalone" output produces a minimal server bundle for the production Docker image
// (docker/Dockerfile sets NEXT_OUTPUT_STANDALONE=true). It is off otherwise because creating its pnpm symlinks
// fails on Windows without Developer Mode. Native and Node-only packages stay external, so their binaries are
// copied, not bundled.
// Security headers apply to every response; Caddy adds HSTS in front (NFR-07).

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode to surface double-invocation bugs early.
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  serverExternalPackages: ["argon2", "pg", "exceljs", "@prisma/client"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
