/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 'pg' is only used by the /install provisioning path; keep it external so
  // Next doesn't try to bundle its optional native bits.
  serverExternalPackages: ["pg", "node-ssh", "ssh2"],
  experimental: {
    typedRoutes: false,
    // Allow Server Action POSTs when the app is opened over a LAN/IP host (not
    // just localhost). In Next 15 this lives under `experimental.serverActions`.
    serverActions: {
      allowedOrigins: [
        "localhost:3000", "localhost:3001", "localhost:3002", "localhost:3003", "localhost:3004", "localhost:3005",
        "127.0.0.1:3000", "127.0.0.1:3001", "127.0.0.1:3002", "127.0.0.1:3003", "127.0.0.1:3004", "127.0.0.1:3005",
        "169.254.123.172:3000",
      ],
    },
  },
};

export default nextConfig;
