import "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    validated?: {
      body?: any;
      params?: any;
      query?: any;
    };
  }
}
