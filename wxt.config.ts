import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  manifest: {
    name: "Regent",
    description: "Provider-agnostic browser agent",
    permissions: ["debugger", "storage", "scripting", "sidePanel", "tabs", "activeTab"],
    host_permissions: ["<all_urls>"],
    side_panel: {
      default_path: "/sidepanel.html",
    },
    action: {
      default_title: "Open Regent",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
