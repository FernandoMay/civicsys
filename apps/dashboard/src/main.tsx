import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import { WalletProvider } from "./lib/wallet.js";
import { freighterAdapter } from "./lib/freighter.js";
import "./styles.brujula.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found in index.html");

createRoot(container).render(
  <StrictMode>
    <WalletProvider adapter={freighterAdapter}>
      <App />
    </WalletProvider>
  </StrictMode>,
);