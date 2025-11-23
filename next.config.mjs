/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  webpack: (config) => {
    // Disable webpack filesystem cache to silence noisy serialization warnings during build
    config.cache = false
    return config
  },
};

export default nextConfig;
