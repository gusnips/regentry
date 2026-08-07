import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "@/lib/theme";
import "./style.css";

initTheme();

createRoot(document.getElementById("root")!).render(<App />);
