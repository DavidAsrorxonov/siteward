import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Siteward",
  description: "Save and manage your important website credentials.",
  version: "0.0.1",
  action: {
    default_title: "Open Siteward",
    default_popup: "src/popup/index.html",
  },
});
