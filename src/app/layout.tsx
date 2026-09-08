import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Dispatch Coordinator",
  description: "Agent-assisted recovery for a Singapore HVAC field-service day",
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
