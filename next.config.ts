import type { NextConfig } from "next";

// output: "standalone" is what the Dockerfile copies out of .next/ for Lightsail.
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Bottom left is the sidebar's workspace switch.
  devIndicators: { position: "top-right" },
};

export default nextConfig;
