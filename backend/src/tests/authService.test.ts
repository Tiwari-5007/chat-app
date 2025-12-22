import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { userService } from "../services/userServices";
import { userRepo } from "../repository/userRepo";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AppError } from "../errors/AppError";

vi.mock("../repository/userRepo");
vi.mock("bcrypt");
vi.mock("jsonwebtoken");

describe("userService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("register", () => {
    test("should throw AppError if required fields are missing", async () => {
      await expect(userService.register({ username: "", name: "", password: "" }))
        .rejects
        .toBeInstanceOf(AppError);
    });

    test("should throw AppError if username already exists", async () => {
      (userRepo.findByUsername as any).mockResolvedValue({ id: 1 });
      await expect(userService.register({ username: "test", name: "Test", password: "pass123" }))
        .rejects
        .toMatchObject({ message: "Username already Exists" });
    });

    test("should hash password and create new user", async () => {
      (userRepo.findByUsername as any).mockResolvedValue(null);
      (bcrypt.hash as any).mockResolvedValue("hashedPass");
      (userRepo.createUser as any).mockResolvedValue({ id: 123 });

      const userId = await userService.register({ username: "newuser", name: "New User", password: "pass123" });

      expect(bcrypt.hash).toHaveBeenCalledWith("pass123", 10);
      expect(userRepo.createUser).toHaveBeenCalledWith({
        username: "newuser",
        name: "New User",
        password: "hashedPass",
      });
      expect(userId).toBe("123");
    });
  });

  describe("login", () => {
    test("should throw AppError if username or password is missing", async () => {
      await expect(userService.login({ username: "", password: "" }))
        .rejects
        .toMatchObject({ message: "Username and password are required." });
    });

    test("should throw AppError if user not found", async () => {
      (userRepo.findByUsername as any).mockResolvedValue(null);

      await expect(userService.login({ username: "nonexistent", password: "pass" }))
        .rejects
        .toMatchObject({ message: "Either Username or Password is wrong." });
    });

    test("should throw AppError if password is incorrect", async () => {
      (userRepo.findByUsername as any).mockResolvedValue({ id: 1, password: "hashedPass" });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(userService.login({ username: "user", password: "wrongPass" }))
        .rejects
        .toMatchObject({ message: "Either Username or Password is wrong." });
    });

    test("should return JWT token if credentials are valid", async () => {
      (userRepo.findByUsername as any).mockResolvedValue({ id: 1, password: "hashedPass" });
      (bcrypt.compare as any).mockResolvedValue(true);
      (jwt.sign as any).mockReturnValue("mockedToken");

      const token = await userService.login({ username: "user", password: "pass123" });

      expect(bcrypt.compare).toHaveBeenCalledWith("pass123", "hashedPass");
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: 1 },
        process.env.JWT_SECRET || "default_secret",
        { expiresIn: "1h" }
      );
      expect(token).toBe("mockedToken");
    });
  });
});
