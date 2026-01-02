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
      bodySizeLimit: '10mb',
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
    // Disable webpack filesystem cache to silence noisy serialization warnings during build
    config.cache = false
    config.externals.push('@napi-rs/canvas')

    // Explicitly disable minification to bypass WebpackError
    if (config.optimization) {
      config.optimization.minimize = false
    }

    return config
  },
};

export default nextConfig;
