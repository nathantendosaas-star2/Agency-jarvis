"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const passwordInput = document.getElementById("password");
  const button = document.getElementById("login-button");
  const error = document.getElementById("login-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    button.disabled = true;
    button.textContent = "Signing in…";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: passwordInput.value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to sign in.");
      window.location.replace("/");
    } catch (err) {
      error.textContent = err.message || "Unable to sign in. Please try again.";
      passwordInput.value = "";
      passwordInput.focus();
      button.disabled = false;
      button.textContent = "Sign in →";
    }
  });
});