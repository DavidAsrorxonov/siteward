import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Siteward",
  description: "Save and manage your important website credentials.",
  version: "0.0.1",
  permissions: ["sidePanel"],
  action: {
    default_title: "Open Siteward",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
});
