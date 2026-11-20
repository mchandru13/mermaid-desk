import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { setupMonaco } from "./lib/monaco";

setupMonaco();

const container = document.getElementById("root");
if (!container) throw new Error("Root element is missing");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
