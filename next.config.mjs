/** @type {import('next').NextConfig} */
const nextConfig = {
  // A production `next build` writes to the same .next/ that `next dev` is
  // serving from, which silently breaks a running dev server ("Cannot find
  // module './331.js'"). Setting BUILD_DIR sends builds elsewhere:
  //   BUILD_DIR=.next-build npm run build
  ...(process.env.BUILD_DIR ? { distDir: process.env.BUILD_DIR } : {}),
};

export default nextConfig;
