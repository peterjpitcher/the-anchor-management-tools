import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import SupabaseProvider from "@/components/providers/SupabaseProvider";
import { ServiceWorkerRegistration } from "@/components/features/shared/ServiceWorkerRegistration";
import { NetworkStatus } from "@/components/features/shared/NetworkStatus";
import { ChunkErrorReloader } from "@/components/features/shared/ChunkErrorReloader";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Management Tools",
  description: "Management tools for The Anchor, including event planning, employee management, and SMS notifications",
  manifest: "/manifest.json",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": -1,
      "max-video-preview": -1,
      "max-image-preview": "none",
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Anchor Tools",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#005131",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {/* <ServiceWorkerRegistration /> */}
        {/* <NetworkStatus /> */}
        <ChunkErrorReloader />
        <Toaster position="top-right" />
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
