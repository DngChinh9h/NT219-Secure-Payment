"use strict";

const stripeProvider = require("./stripeProvider");
const mockBankProvider = require("./mockBankProvider");

const providers = Object.freeze({
  stripe: stripeProvider,
  mock_bank: mockBankProvider,
});

function getProvider(name = "stripe") {
  const providerName = name || "stripe";
  const provider = providers[providerName];

  if (!provider) {
    const err = new Error(`Unsupported payment provider: ${providerName}`);
    err.statusCode = 400;
    throw err;
  }

  return provider;
}

function listProviders() {
  return Object.keys(providers);
}

module.exports = {
  getProvider,
  listProviders,
};
