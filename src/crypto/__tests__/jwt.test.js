"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { verifyJWT } = require("../jwtHelper");

const signingKeys = crypto.generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function externallySignedToken(payload) {
  return jwt.sign(payload, signingKeys.privateKey, {
    algorithm: "ES512", expiresIn: "15m", issuer: "payment-system", audience: "payment-api",
  });
}

describe("backend JWT verification", () => {
  const payload = { userId: "user-123", email: "a@b.com", role: "customer" };

  test("verifies a Security Service-issued ES512 token with a public key", () => {
    const decoded = verifyJWT(externallySignedToken(payload), { publicKey: signingKeys.publicKey });
    expect(decoded).toMatchObject(payload);
  });

  test("does not expose an in-process JWT signer", () => {
    expect(require("../jwtHelper").signJWT).toBeUndefined();
  });

  test("rejects invalid and alg:none tokens", () => {
    expect(() => verifyJWT("invalid.token.here", { publicKey: signingKeys.publicKey })).toThrow();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(() => verifyJWT(`${header}.${body}.`, { publicKey: signingKeys.publicKey })).toThrow();
  });
});
