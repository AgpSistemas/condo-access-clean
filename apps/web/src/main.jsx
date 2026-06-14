import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./landing.css";

const isAppRoute = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");
const Page = lazy(() => isAppRoute ? import("./App.jsx") : import("./pages/LandingPage.jsx"));

createRoot(document.getElementById("root")).render(
  <Suspense fallback={<div className="page-loading">Carregando...</div>}>
    <Page />
  </Suspense>
);
