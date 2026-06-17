"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "secp521r1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

delete process.env.JWT_PRIVATE_KEY_PATH;
delete process.env.JWT_PUBLIC_KEY_PATH;
process.env.JWT_PRIVATE_KEY_B64 = Buffer.from(privateKey).toString("base64");
process.env.JWT_PUBLIC_KEY_B64 = Buffer.from(publicKey).toString("base64");

const { signJWT, verifyJWT } = require("../jwtHelper");

describe("JWT ES512 Helper", () => {
  const testPayload = {
    userId: "user-123",
    email: "a@b.com",
    role: "customer",
  };

  test("signs and verifies the expected payload", () => {
    const token = signJWT(testPayload);
    const decoded = verifyJWT(token);

    expect(decoded.userId).toBe("user-123");
    expect(decoded.email).toBe("a@b.com");
    expect(decoded.role).toBe("customer");
    expect(jwt.decode(token, { complete: true }).header.alg).toBe("ES512");
  });

  test("rejects an invalid token", () => {
    expect(() => verifyJWT("invalid.token.here")).toThrow();
  });

  test("rejects alg:none", () => {
    const payload = Buffer.from(JSON.stringify(testPayload)).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const fakeToken = `${header}.${payload}.`;

    expect(() => verifyJWT(fakeToken)).toThrow();
  });

  test("token has required registered claims", () => {
    const token = signJWT(testPayload);
    const decoded = verifyJWT(token);

    expect(decoded).toHaveProperty("iat");
    expect(decoded).toHaveProperty("exp");
    expect(decoded).toHaveProperty("iss");
  });
});
