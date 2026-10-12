import type { MetadataRoute } from "next";

/** The app is private: only the public removal-request page may be indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/privacy/", disallow: "/" } };
}
