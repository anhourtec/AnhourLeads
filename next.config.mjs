/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tenant hostnames such as acme.localhost:3410 load dev assets too.
  allowedDevOrigins: ["*.localhost", "127.0.0.1"],
  output: "standalone",
  reactCompiler: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/overview",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
