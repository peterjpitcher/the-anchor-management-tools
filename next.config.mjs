const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
const isDevelopment = process.env.NODE_ENV !== 'production'

const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(isDevelopment ? ["'unsafe-eval'"] : []),
  'https://www.paypal.com',
  'https://www.paypalobjects.com',
]

const connectSources = [
  "'self'",
  'https://*.supabase.co',
  'wss://*.supabase.co',
  'https://api-m.paypal.com',
  'https://api-m.sandbox.paypal.com',
  'https://www.paypal.com',
  ...(isDevelopment ? ['http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'] : []),
]

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src ${scriptSources.join(' ')}`,
  `connect-src ${connectSources.join(' ')}`,
  "frame-src 'self' https://www.paypal.com https://*.paypal.com",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob: https:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'bluetooth=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'serial=()',
      'usb=()',
    ].join(', '),
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Access-Control-Allow-Origin', value: appOrigin },
  { key: 'Vary', value: 'Origin' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'tfcasgxopxegwrabvwat.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  serverExternalPackages: [
    'exceljs',
    'pdfkit',
    'puppeteer',
    'puppeteer-core',
    '@tootallnate/quickjs-emscripten',
    'googleapis',
    'microsoft-graph-client',
    'officeparser',
    'pdf-lib',
    'file-type',
    'fs',
    'path',
    'os',
    // Transitive dependencies that crash the build
    'agent-base',
    'https-proxy-agent',
    'pac-proxy-agent',
    'proxy-agent',
    'google-auth-library',
    'basic-ftp',
    'ftp',
    'get-uri',
    'data-uri-to-buffer',
  ],
  webpack: (config, { dev }) => {
    // Production builds have intermittently emitted server chunks with stale paths.
    if (!dev || process.env.NEXT_DISABLE_WEBPACK_CACHE === '1') {
      config.cache = false
    }
    if (Array.isArray(config.externals)) {
      config.externals.push('@napi-rs/canvas')
    }

    return config
  },
};

export default nextConfig;
