/** @type {import('next').NextConfig} */
const smokeDistDir = process.env.NEXT_SMOKE_DIST_DIR;
const hasSafeSmokeDistDir =
  typeof smokeDistDir === 'string' && /^\.next-smoke-[a-f0-9-]+$/.test(smokeDistDir);
const distDir = hasSafeSmokeDistDir
  ? smokeDistDir
  : process.env.NODE_ENV === 'production'
    ? '.next-build'
    : undefined;

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
