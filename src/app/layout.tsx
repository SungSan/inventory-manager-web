import type { Metadata, Viewport } from "next";
import "@/app/globals.css";
import "@/app/v1-3.css";
import "@/app/transfer.css";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "Barcode WMS v1",
  description: "상품·로케이션 바코드 기반 실시간 재고관리",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16202a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><PwaRegister /><AppShell>{children}</AppShell></body></html>;
}
