"use strict";

const LOCAL_FRONTEND_ORIGIN = "http://localhost:5173";

function isLocalFrontendAllowed() {
  return process.env.NODE_ENV !== "production";
}

function getAllowedOrigins() {
  const configuredOrigins = [
    ...(process.env.CORS_ORIGINS || "").split(","),
    process.env.FRONTEND_ORIGIN || "",
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [
    ...new Set([
      ...(isLocalFrontendAllowed() ? [LOCAL_FRONTEND_ORIGIN] : []),
      ...configuredOrigins,
    ]),
  ];
}

function createCorsOptions() {
  return {
    origin(origin, callback) {
      if (!origin || getAllowedOrigins().includes(origin)) {
        return callback(null, true);
      }

      const err = new Error("Origin not allowed by CORS");
      err.statusCode = 403;
      return callback(err);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
  };
}

function isCorsRestricted() {
  return true;
}

module.exports = {
  LOCAL_FRONTEND_ORIGIN,
  createCorsOptions,
  getAllowedOrigins,
  isCorsRestricted,
  isLocalFrontendAllowed,
};
