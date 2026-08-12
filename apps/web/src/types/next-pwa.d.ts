declare module 'next-pwa' {
  import { NextConfig } from 'next';
  const withPWA: (config: any) => (nextConfig: NextConfig) => NextConfig;
  export default withPWA;
} 