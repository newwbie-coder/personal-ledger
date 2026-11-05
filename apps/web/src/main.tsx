import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { FirmProvider } from "./firm";
import { ViewModeProvider } from "./view-mode";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ViewModeProvider>
          <FirmProvider>
            <App />
          </FirmProvider>
        </ViewModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
