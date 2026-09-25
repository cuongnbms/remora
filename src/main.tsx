import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applySettings, readCachedSettings } from "./lib/settings";
import "./styles.css";

// Paint with the last-used theme and fonts before config.json arrives, avoiding a flash.
applySettings(readCachedSettings());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
