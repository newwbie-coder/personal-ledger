import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { FirmProvider } from "./firm";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FirmProvider>
          <App />
        </FirmProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
