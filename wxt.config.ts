import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    homepage_url: "https://github.com/gusnips/regent",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    permissions: ["debugger", "storage", "scripting", "sidePanel", "tabs", "activeTab", "notifications"],
    host_permissions: ["<all_urls>"],
    side_panel: {
      default_path: "/sidepanel.html",
    },
    action: {
      default_title: "__MSG_actionTitle__",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
