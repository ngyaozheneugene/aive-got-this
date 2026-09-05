import type { NextConfig } from "next";

// output: "standalone" is what the Dockerfile copies out of .next/. Changing it
// breaks the App Runner image and the t3.small fallback in README §11.
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
