/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strip X-Powered-By header
  poweredByHeader: false,
  // No source maps in production builds (smaller output, no code exposure)
  productionBrowserSourceMaps: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.in',
      },
    ],
  },
  compress: true,
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}',
      skipDefaultConversion: true,
    },
    'date-fns': {
      transform: 'date-fns/{{ member }}',
    },
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'recharts',
      'framer-motion',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'react-hook-form',
      '@hookform/resolvers',
    ],
  },
}

export default nextConfig
