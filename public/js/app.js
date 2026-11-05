"use strict";

// Dynamic API Base URL configuration
// In Netlify, window.API_BASE_URL can be set via a snippet or config, or fallback to current origin.
const API_BASE_URL = (window.API_BASE_URL || localStorage.getItem("jarvis_api_base_url") || "").replace(/\/$/, "");

async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;
  const opts = {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  };
  return fetch(url, opts);
}

window.apiFetch = apiFetch;
window.API_BASE_URL = API_BASE_URL;

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
        await apiFetch("/api/auth/logout", {
          method: "POST"
        });
      } finally {
        window.location.replace("/login");
      }
    });
    footer.appendChild(logout);
  }
});
