import { Schema } from "zod";
import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
export const reqValidator = (schema: Schema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log("Request Validator Middleware");
    const result = schema.safeParse({
      body: req?.body,
      params: req?.params,
      query: req?.query
    });
    if (!result.success) {
      next(new AppError(400, "VALIDATION_ERROR", result.error.issues[0].message));
      // return res.status(400).json({
      //   status: "FAILURE",
      //   message: result.error.issues[0].message,
      //   data: null
      // });
    }
    console.log(result.data);
    const validatedData = result.data as { body?: any; params?: any; query?: any };
    req.validated = validatedData;
    next();
  };
};