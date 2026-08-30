import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import "./fonts.css";
import "./styles.css";

// тема применяется до первого рендера, чтобы не мигало; meta theme-color держим в цвете фона
const initialTheme = localStorage.getItem("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = initialTheme;
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
if (themeColorMeta) themeColorMeta.setAttribute("content", initialTheme === "light" ? "#ffffff" : "#0b1120");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
