"use strict";

function getPublicConfig(req, res) {
  return res.status(200).json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    environment: process.env.PUBLIC_APP_ENV || "sandbox",
    providers: {
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      mock_bank: true,
    },
  });
}

module.exports = { getPublicConfig };
