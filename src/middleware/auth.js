function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();

  const acceptsHtml = req.accepts(["html", "json"]) === "html";
  if (req.path.startsWith("/api/") || !acceptsHtml) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return res.redirect("/login");
}

module.exports = { requireAdmin };