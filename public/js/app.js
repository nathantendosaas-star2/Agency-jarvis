"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll(".nav-link").forEach((link) => {
    const linkPath = new URL(link.href).pathname.replace(/\/$/, "") || "/";
    if (linkPath === currentPath) link.classList.add("active");
  });

  const footer = document.querySelector(".sidebar-footer");
  if (footer) {
    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "logout-button";
    logout.textContent = "Sign out";
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      logout.textContent = "Signing out…";
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" }
        });
      } finally {
        window.location.replace("/login");
      }
    });
    footer.appendChild(logout);
  }
});