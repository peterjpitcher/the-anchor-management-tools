import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import SupabaseProvider from "@/components/providers/SupabaseProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { NetworkStatus } from "@/components/NetworkStatus";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Management Tools",
  description: "Management tools for The Anchor, including event planning, employee management, and SMS notifications",
  manifest: "/manifest.json",
  themeColor: "#005131",
  viewport: "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Anchor Tools",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ServiceWorkerRegistration />
        <NetworkStatus />
        <Toaster position="top-right" />
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
