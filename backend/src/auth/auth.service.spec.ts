import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { HttpStatus, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import {
  User,
  ApAccessConfig,
  ApCredential,
  AccessModel,
} from "../database/entities";

describe("AuthService", () => {
  let service: AuthService;
  let userRepo: any;
  let accessConfigRepo: any;
  let credentialRepo: any;
  let jwtService: any;

  const mockUser = {
    id: "user-1",
    username: "testuser",
    displayName: "Test User",
    isAppAdmin: false,
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
    };
    accessConfigRepo = {
      findOne: jest.fn(),
    };
    credentialRepo = {
      findOne: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue("mock-jwt-token"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ApAccessConfig),
          useValue: accessConfigRepo,
        },
        {
          provide: getRepositoryToken(ApCredential),
          useValue: credentialRepo,
        },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe("credentialLogin", () => {
    it("should return token for valid AP credentials", async () => {
      const hashedPw = await bcrypt.hash("cred-pass", 12);
      const config = {
        id: "config-1",
        apId: "ap-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        validFrom: null,
        validUntil: null,
        credentials: [{ username: "creduser", passwordHash: hashedPw }],
      };
      accessConfigRepo.findOne.mockResolvedValue(config);
      credentialRepo.findOne.mockResolvedValue({
        username: "creduser",
        passwordHash: hashedPw,
      });

      const result = await service.credentialLogin(
        "ap-1",
        "creduser",
        "cred-pass",
      );
      expect(result.accessToken).toBe("mock-jwt-token");
      expect(result.apId).toBe("ap-1");
    });

    it("should throw when access config not found", async () => {
      accessConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.credentialLogin("ap-1", "u", "p")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should rate-limit repeated failed credential logins", async () => {
      const hashedPw = await bcrypt.hash("cred-pass", 12);
      accessConfigRepo.findOne.mockResolvedValue({
        id: "config-1",
        apId: "ap-1",
        accessModel: AccessModel.CREDENTIALS_LIST,
        validFrom: null,
        validUntil: null,
      });
      credentialRepo.findOne.mockResolvedValue({
        username: "creduser",
        passwordHash: hashedPw,
      });

      for (let i = 0; i < 5; i++) {
        await expect(
          service.credentialLogin(
            "ap-1",
            "creduser",
            "wrong-password",
            "1.2.3.4",
          ),
        ).rejects.toThrow(UnauthorizedException);
      }

      await expect(
        service.credentialLogin(
          "ap-1",
          "creduser",
          "wrong-password",
          "1.2.3.4",
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });
  });

  describe("getProfile", () => {
    it("should return user profile", async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser, apRoles: [] });
      const result = await service.getProfile("user-1");
      expect(result.username).toBe("testuser");
    });

    it("should throw on unknown user", async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfile("bad-id")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("generateTokenForOidcUser", () => {
    it("should include AP roles in returned user payload", async () => {
      const result = await service.generateTokenForOidcUser({
        sub: "user-1",
        username: "testuser",
        displayName: "Test User",
        isAppAdmin: false,
        apRoles: [{ apId: "ap-1", role: "AP_MANAGER" }],
      });

      expect(result.accessToken).toBe("mock-jwt-token");
      expect(result.user).toMatchObject({
        id: "user-1",
        username: "testuser",
        isAppAdmin: false,
        apRoles: [{ apId: "ap-1", role: "AP_MANAGER" }],
      });
    });
  });
});
