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
    homepage_url: "https://tabrunner.app",
    // Public half of tabrunner-test.pem — pins every unpacked/dev load to the
    // CRX's id (dfmcnfgiddfdjciciaflpieglmmgdmhh) instead of a per-machine one,
    // so the MCP bridge's expected id holds in dev too. The store id will be a
    // second, CWS-owned value once published; the daemon default tracks the CRX.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3ZlVSo9td5K/VDX4FnlLA9c+HyCesWBcxD3ZtseoOqGvxOLtFcDmjlrQC334scbMAFvKR2udEVT0HrwtlhkJWdXKMloxwTvpeFZ1aAKmf7hmia9LhylqXiugykS7/aARuJITvxVZ/hG40HvZ42T8T57SUNmefPXQDKl2YggQunNPlfYw7LodPS7gcUwWcgxK8+09E3RUam+FZ3ry32yIHWExkw23CoNRsBaMrYA+n1R/LAgK6g7/r4FXbngNpw39Kn/9ytE3hGLXM89x6M4iN01WQ4dyRWT9xYD2pN8Ydcgrf2UP+IWBWROJyMPpp9Vay5A4j5/1jS6yRPCMtKu7OQIDAQAB",
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
      // Background runs open their own tab and label its group with the task.
      "tabGroups",
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
      // The shared UI chunk (React + Base UI + i18n, ~556 kB) trips Vite's
      // 500 kB warning, which is tuned for pages shipped over a network.
      // Extension pages load from disk, the service worker stays lean (the
      // ESLint runtime boundary keeps UI out of it), and code-splitting the
      // panel would buy nothing — 750 leaves headroom while still catching a
      // genuinely accidental heavyweight import.
      chunkSizeWarningLimit: 750,
    },
  }),
});
