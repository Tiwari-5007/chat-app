import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler } from "../middlewares/errorHandler";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { AppError } from "../errors/AppError";
import { mapPrismaError } from "../errors/prismaErrorMapper";
import logger from "../lib/logger";

// ---------------------- MOCKS -----------------------
vi.mock("../errors/prismaErrorMapper", () => ({
  mapPrismaError: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  default: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

describe("errorHandler middleware (Vitest)", () => {
  let req: any;
  let res: any;
  const next = vi.fn();

  beforeEach(() => {
    req = { method: "GET", path: "/test" };
    res = {
      locals: { requestId: "req-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1) Prisma Error branch
  // ---------------------------------------------------------------------------
  it("handles PrismaClientKnownRequestError (system error)", () => {
    const prismaError = new PrismaClientKnownRequestError("msg", {
      clientVersion: "1.x",
      code: "P2002",
    });

    (mapPrismaError as any).mockReturnValue(
      new AppError(409, "PRISMA_ERROR", "Prisma failed")
    );

    errorHandler(prismaError as any, req, res, next);

    expect(mapPrismaError).toHaveBeenCalledWith(prismaError);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      status: "FAILURE",
      msg: "Prisma failed",
      data: null,
    });
  });

  // ---------------------------------------------------------------------------
  // 2) AppError branch (client error)
  // ---------------------------------------------------------------------------
  it("handles AppError without system log", () => {
    const appError = new AppError(400, "BAD_REQUEST", "Invalid input");

    errorHandler(appError, req, res, next);

    expect(logger.debug).toHaveBeenCalledOnce(); // client log
    expect(logger.error).not.toHaveBeenCalled(); // NO system log
    expect(logger.info).toHaveBeenCalledOnce();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: "FAILURE",
      msg: "Invalid input",
      data: null,
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Unknown error branch -> converted to AppError (with message)
  // ---------------------------------------------------------------------------
  it("handles unknown error (system error)", () => {
    const unknownErr = new Error("Boom!");

    errorHandler(unknownErr, req, res, next);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: "FAILURE",
      msg: "Internal Server Error",
      data: null,
    });
  });

  // ---------------------------------------------------------------------------
  // 4) Unknown error WITHOUT `.message` (branch coverage)
  // ---------------------------------------------------------------------------
  it("handles unknown error without message", () => {
    const unknownErr = { rawError: true }; // no .message

    errorHandler(unknownErr as any, req, res, next);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: "FAILURE",
      msg: "Internal Server Error",
      data: null,
    });
  });

  // ---------------------------------------------------------------------------
  // 5) next() must never be called
  // ---------------------------------------------------------------------------
  it("never calls next()", () => {
    const appError = new AppError(404, "NOT_FOUND", "Not found");

    errorHandler(appError, req, res, next);

    expect(next).not.toHaveBeenCalled();
  });
});
