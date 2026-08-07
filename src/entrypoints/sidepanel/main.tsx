import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "@/lib/theme";
import { initUiI18n } from "@/i18n/ui";
import "./style.css";

initTheme();

void initUiI18n().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
