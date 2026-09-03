import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Waiver-Wire",
    short_name: "Waiver-Wire",
    description: "Weekly start/sit and waiver decisions for a Sleeper fantasy football league.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#10151f",
    theme_color: "#10151f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
