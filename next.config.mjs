/** @type {import('next').NextConfig} */
const smokeDistDir = process.env.NEXT_SMOKE_DIST_DIR;
const hasSafeSmokeDistDir =
  typeof smokeDistDir === 'string' && /^\.next-smoke-[a-f0-9-]+$/.test(smokeDistDir);

const nextConfig = {
  ...(hasSafeSmokeDistDir ? { distDir: smokeDistDir } : {}),
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
