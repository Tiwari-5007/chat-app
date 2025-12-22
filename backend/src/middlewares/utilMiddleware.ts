import { Request, Response, NextFunction } from "express";
import { generateUniqueId } from "../utils/utils";

export function reqIdMiddleware(req: Request, res: Response, next: NextFunction) {
    req.requestId = generateUniqueId();
    res.locals.requestId = req.requestId;
    next();
}
