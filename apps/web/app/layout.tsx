import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import { RegisterServiceWorker } from "@/components/register-sw";

import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Waiver-Wire",
  description: "Weekly start/sit and waiver decisions for a Sleeper fantasy football league.",
  appleWebApp: { capable: true, title: "Waiver-Wire", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#10151f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
