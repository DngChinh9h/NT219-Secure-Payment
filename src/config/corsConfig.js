"use strict";

const LOCAL_FRONTEND_ORIGIN = "http://localhost:5173";

function getAllowedOrigins() {
  const configuredOrigins = [
    ...(process.env.CORS_ORIGINS || "").split(","),
    process.env.FRONTEND_ORIGIN || "",
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([LOCAL_FRONTEND_ORIGIN, ...configuredOrigins])];
}

function createCorsOptions() {
  return {
    origin(origin, callback) {
      if (!origin || getAllowedOrigins().includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
  };
}

module.exports = {
  LOCAL_FRONTEND_ORIGIN,
  createCorsOptions,
  getAllowedOrigins,
};
