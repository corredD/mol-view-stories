import type { NextConfig } from "next";

// Dev-only MCP HTTP API uses `dynamic = "force-dynamic"` route handlers,
// which are incompatible with static export. Toggle export off when the
// dev API is enabled so `pnpm dev:web` can serve /api/dev/*.
const devApiEnabled = process.env.NEXT_PUBLIC_DEV_API === "1";

// The dev API handlers are named `route.dev.ts`, which Next only recognizes as
// a route file when "dev.ts" is in pageExtensions. That is what keeps the
// default (static-export) build green: with the flag off the files are never
// collected, so their `force-dynamic` exports can't clash with
// `output: "export"`. Renaming one to `route.ts` would break `pnpm build`.
const pageExtensions = devApiEnabled
  ? ["dev.ts", "ts", "tsx", "js", "jsx"]
  : ["ts", "tsx", "js", "jsx"];

// Single source of truth for the URL prefix. Read from env so the same value
// can be used both here (Next.js routing) and at runtime in client fetches.
// Defaults to "/mol-view-stories" in production for back-compat with the
// existing static-export deploy that lived under that path.
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/mol-view-stories" : "");

const nextConfig: NextConfig = {
  ...(devApiEnabled ? {} : { output: "export" }),
  pageExtensions,
  trailingSlash: true,
  basePath,
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@jsr/molstar__molstar-components"],
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^npm:/,
        (resource: { request: string }) => {
          resource.request = resource.request
            .slice(4)
            .replace(/((?:@[^@/]+\/)?[^@/]+)@[^/]*(.*)/g, "$1$2");
        }
      )
    );
    return config;
  },
};

export default nextConfig;
