"use strict";

const fs = require("fs");
const path = require("path");

describe("local compose Security Service topology", () => {
  test("uses the mandatory security-service DNS name and never localhost between services", () => {
    const compose = fs.readFileSync(path.resolve(__dirname, "../../../docker-compose.yml"), "utf8");
    expect(compose).toMatch(/^  security-service:/m);
    expect(compose).toMatch(/SECURITY_SERVICE_BASE_URL: https:\/\/security-service:9443/);
    expect(compose).toMatch(/security-service:\n        condition: service_started/);
    expect(compose).not.toMatch(/SECURITY_SERVICE_BASE_URL: https?:\/\/localhost/i);
  });
});
