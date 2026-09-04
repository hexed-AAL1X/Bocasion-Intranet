/* eslint-disable @typescript-eslint/no-require-imports -- Next config en CommonJS estable */
const path = require("path");

const isExport = process.env.NEXT_EXPORT === "1";
/** Vacío = sitio en la raíz del dominio. `/out` si publicas en https://dominio.com/out/ (chunk URLs serán /out/_next/...). */
const basePath = process.env.BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isExport ? { output: "export", trailingSlash: true } : {}),
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

module.exports = nextConfig;
