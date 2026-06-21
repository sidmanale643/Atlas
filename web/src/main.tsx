import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import "./theme/theme.css";
import App from "./App";
import AuthProvider from "./auth/AuthProvider";

// StrictMode is intentionally omitted: the Atlas page wraps a self-booting legacy
// Three.js module, and StrictMode's dev double-mount would create a duplicate WebGL
// context against torn-down DOM. See web/src/pages/Atlas.tsx.
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    {/* reducedMotion="user" makes every Framer Motion animation collapse to
        instant when the OS "reduce motion" preference is set. */}
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <App />
      </AuthProvider>
    </MotionConfig>
  </BrowserRouter>,
);
