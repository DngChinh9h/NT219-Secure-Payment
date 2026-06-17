"use strict";

const helmet = require("helmet");

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

function sensitiveNoStore(req, res, next) {
  if (
    req.path.startsWith("/api/auth/") ||
    req.path.startsWith("/api/admin/")
  ) {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
  }

  next();
}

function getSecurityHeadersEvidence() {
  return {
    enabled: true,
    helmet: true,
    xPoweredByDisabled: true,
    sensitiveNoStore: true,
    contentSecurityPolicy: "default-src 'none'",
  };
}

module.exports = {
  getSecurityHeadersEvidence,
  securityHeaders,
  sensitiveNoStore,
};
