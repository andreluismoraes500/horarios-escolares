import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { useTema } from "@/stores/tema";
import "./index.css";

function Raiz() {
  const tema = useTema((s) => s.tema);
  return (
    <>
      <HashRouter>
        <App />
      </HashRouter>
      <Toaster position="bottom-right" richColors closeButton theme={tema === "escuro" ? "dark" : "light"} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Raiz />
  </React.StrictMode>,
);
