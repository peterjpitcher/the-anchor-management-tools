import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import SupabaseProvider from "@/components/providers/SupabaseProvider";
import { ServiceWorkerCleanup } from "@/components/features/shared/ServiceWorkerRegistration";
import { ChunkErrorReloader } from "@/components/features/shared/ChunkErrorReloader";
import { getDeploymentVersion } from "@/lib/foh/deployment-version";

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
      <head>
        <meta name="app-deployment-version" content={getDeploymentVersion()} />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ServiceWorkerCleanup />
        <ChunkErrorReloader deploymentVersion={getDeploymentVersion()} />
        {/* Matches the DS toast (src/ds/primitives/Toast.tsx) so direct react-hot-toast calls
            look the same as toast.success() from @/ds. */}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: 'var(--radius-default)',
              padding: '12px 14px',
              fontSize: '0.875rem',
              maxWidth: '28rem',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg)',
            },
            success: {
              style: {
                background: 'var(--color-success-soft)',
                color: 'var(--color-success-fg)',
                border: '1px solid var(--color-success-border)',
              },
              iconTheme: { primary: 'var(--color-success)', secondary: 'var(--color-surface)' },
            },
            error: {
              style: {
                background: 'var(--color-danger-soft)',
                color: 'var(--color-danger-fg)',
                border: '1px solid var(--color-danger-border)',
              },
              iconTheme: { primary: 'var(--color-danger)', secondary: 'var(--color-surface)' },
            },
          }}
        />
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
