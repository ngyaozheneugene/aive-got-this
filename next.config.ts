import type { NextConfig } from "next";

// output: "standalone" is what the Dockerfile copies out of .next/ for Lightsail.
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
