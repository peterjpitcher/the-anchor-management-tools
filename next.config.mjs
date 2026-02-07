/** @type {import('next').NextConfig} */
const nextConfig = {
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
    'puppeteer',
    'puppeteer-core',
    '@tootallnate/quickjs-emscripten',
    'googleapis',
    'microsoft-graph-client',
    'pdf-lib',
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
  webpack: (config) => {
    // Keep filesystem cache enabled by default for faster incremental builds.
    if (process.env.NEXT_DISABLE_WEBPACK_CACHE === '1') {
      config.cache = false
    }
    if (Array.isArray(config.externals)) {
      config.externals.push('@napi-rs/canvas')
    }

    return config
  },
};

export default nextConfig;
