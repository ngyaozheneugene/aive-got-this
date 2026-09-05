import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Dispatch Coordinator",
  description: "An AI coordinator for Singapore HVAC SMEs",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
