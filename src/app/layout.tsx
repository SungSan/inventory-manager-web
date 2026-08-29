import type { Metadata, Viewport } from "next";
import "@/app/globals.css";
import "@/app/v1-3.css";
import "@/app/transfer.css";
import "@/app/v1-4.css";
import "@/app/location-map.css";
import "@/app/location-map-states.css";
import "@/app/multi-product-picker.css";
import "@/app/external-shipment-print.css";
import "@/app/stocktake-v381.css";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "SAN WMS",
  description: "상품·로케이션 바코드 기반 실시간 재고관리",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/san-wms-favicon.ico" },
      { url: "/san-wms-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/san-wms-app-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/san-wms-app-icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#171B1F",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><PwaRegister /><AppShell>{children}</AppShell></body></html>;
}
