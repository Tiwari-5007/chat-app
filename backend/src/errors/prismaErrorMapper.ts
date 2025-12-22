import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { AppError } from "./AppError";

export function mapPrismaError(err: PrismaClientKnownRequestError): AppError {
  switch (err.code) {
    case "P2002": {
      const fields = (err.meta?.target ?? []) as string[];
      return new AppError(
        409,
        "UNIQUE_CONSTRAINT",
        "Record already exists.",
        { fields }
      );
    }

    case "P2025":
      return new AppError(404, "NOT_FOUND", "Record not found.");

    default:
      return new AppError(
        500,
        "PRISMA_ERROR",
        "Unexpected database error.",
        { code: err.code, meta: err.meta }
      );
  }
}
