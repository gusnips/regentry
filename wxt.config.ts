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
    homepage_url: "https://github.com/gusnips/regentry",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    permissions: [
      "debugger",
      "storage",
      "scripting",
      "sidePanel",
      "tabs",
      "activeTab",
      "notifications",
      // The MCP bridge's reconcile alarm — wakes a suspended worker to reconnect.
      "alarms",
      // Lets the browser strip Origin from our own provider calls: a subscription
      // OAuth token is refused by Anthropic's per-organization CORS gate when it
      // arrives with a browser Origin, which is exactly what the worker's fetch
      // sends (an MV3 service worker is a document context). A CLI has no Origin
      // at all; removing it makes our request look the same way.
      "declarativeNetRequestWithHostAccess",
    ],
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
    build: {
      // Extension pages load in an isolated world, so Chrome rejects Vite's
      // <link rel="modulepreload"> for our own chunks as a "cross-world resource
      // mismatch" and warns twice per chunk. The module graph is local and the
      // script tag pulls it in anyway — the preload buys nothing here.
      modulePreload: false,
    },
  }),
});
