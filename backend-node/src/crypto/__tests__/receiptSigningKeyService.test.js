"use strict";

const mockDbQuery = jest.fn();
const mockDbConnect = jest.fn();
jest.mock("../../db", () => ({
  query: mockDbQuery,
  connect: mockDbConnect,
}));

const mockGenerateDataKey = jest.fn();
const mockUnwrapDataKey = jest.fn();
jest.mock("../../kms/kmsService", () => ({
  generateDataKey: mockGenerateDataKey,
  unwrapDataKey: mockUnwrapDataKey,
}));

const service = require("../receiptSigningKeyService");

describe("receiptSigningKeyService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses legacy version 1 when the deploy migration has not run yet", async () => {
    mockDbQuery.mockRejectedValueOnce({ code: "42P01" });

    await expect(service.getKeyStatus()).resolves.toEqual({
      activeKeyVersion: 1,
      availableKeyVersions: [1],
      availablePublicKeyVersions: [1],
      keyRotationEnabled: false,
      keyStoreReady: false,
      keys: [],
    });
  });

  test("returns safe public key version metadata without private key material", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          key_version: 2,
          active: true,
          created_at: "2026-06-01T00:00:00.000Z",
          rotated_at: null,
        },
      ],
    });

    const status = await service.getKeyStatus();

    expect(status).toEqual({
      activeKeyVersion: 2,
      availableKeyVersions: [1, 2],
      availablePublicKeyVersions: [1, 2],
      keyRotationEnabled: false,
      keyStoreReady: true,
      keys: [
        {
          keyVersion: 2,
          active: true,
          createdAt: "2026-06-01T00:00:00.000Z",
          rotatedAt: null,
        },
      ],
    });
    expect(JSON.stringify(status)).not.toMatch(/private|encrypted|wrapped/i);
  });

  test("rotates to version 2 and stores encrypted private key material", async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    mockDbConnect.mockResolvedValueOnce(client);
    mockGenerateDataKey.mockReturnValueOnce({
      plaintext: Buffer.alloc(32, 7),
      wrapped: "wrapped-key",
    });
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ next_version: 2 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          key_version: 2,
          active: true,
          created_at: "2026-06-01T00:00:00.000Z",
          rotated_at: null,
        },
      ],
    });

    const status = await service.rotateSigningKey();

    expect(status.activeKeyVersion).toBe(2);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO receipt_signing_keys"),
      expect.arrayContaining([
        2,
        expect.stringContaining("BEGIN PUBLIC KEY"),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "wrapped-key",
      ]),
    );
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });
});
