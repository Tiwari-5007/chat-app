import { describe, it, expect, vi, beforeEach } from "vitest";
import { register, login, logout } from "../controllers/authControllers";
import { userService } from "../services/userServices";

describe("Auth Controller", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = { body: {}, validated: { body: {} } };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe("register", () => {
    it("should call userService.register and return 201", async () => {
      // Mock the service
      vi.spyOn(userService, "register").mockResolvedValueOnce("user-123");

      req.body = { username: "john", password: "pass123" };

      await register(req, res, next);

      expect(userService.register).toHaveBeenCalledWith(req.body);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        status: "SUCCESS",
        data: { userId: "user-123" },
      });
    });

    it("should call next with error if service throws", async () => {
      const error = new Error("Failed");
      vi.spyOn(userService, "register").mockRejectedValueOnce(error);

      await register(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("login", () => {
    it("should call userService.login and return 200 with token", async () => {
      vi.spyOn(userService, "login").mockResolvedValueOnce("token-123");

      req.validated.body = { username: "john", password: "pass123" };

      await login(req, res, next);

      expect(userService.login).toHaveBeenCalledWith(req.validated.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: "SUCCESS",
        msg: "",
        data: { token: "token-123" },
      });
    });

    it("should call next with error if service throws", async () => {
      const error = new Error("Login failed");
      vi.spyOn(userService, "login").mockRejectedValueOnce(error);

      await login(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("logout", () => {
    it("should return 200 with success message", () => {
      logout(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith("Success");
    });

    it("should call next with error if something fails", () => {
      const error = new Error("Oops");
      // Force res.status to throw
      res.status = vi.fn(() => { throw error; });

      logout(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
