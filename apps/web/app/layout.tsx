import type { Metadata } from "next";
import { Archivo } from "next/font/google";

import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Waiver-Wire",
  description: "Weekly start/sit and waiver decisions for a Sleeper fantasy football league.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
