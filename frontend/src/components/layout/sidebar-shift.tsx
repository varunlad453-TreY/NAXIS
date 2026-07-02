"use client";

import { useEffect } from "react";

export function SidebarShift() {
  useEffect(() => {
    function sync() {
      const collapsed = localStorage.getItem("sidebar-collapsed") === "true";
      document.documentElement.style.setProperty("--sidebar-w", collapsed ? "60px" : "224px");
    }
    sync();
    window.addEventListener("storage", sync);
    // Also listen to a custom event fired by the sidebar toggle
    window.addEventListener("sidebar-toggle", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("sidebar-toggle", sync);
    };
  }, []);
  return null;
}
