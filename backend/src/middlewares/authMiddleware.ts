import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import jwt from "jsonwebtoken";

export function authMiddleware (req: Request, _res: Response, next: NextFunction) {
    const headers = req.headers.authorization;
    if(!headers && !headers?.startsWith('Bearer ')) {
        next (new AppError(400, "AUTHORIZATION_ERROR", "Authorization header missing or malformed"))
    }
    const token = headers?.split(' ')[1];
    if(!token) {
        next (new AppError(400, "AUTHORIZATION_ERROR", "Token missing"))
        return;
    }
    try{
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            next(new AppError(500, "AUTHORIZATION_ERROR", "JWT_SECRET is not configured"));
            return;
        }
        const payload = jwt.verify(token, jwtSecret);
        req.user = payload;
        next();
    } catch (error) {
        next(new AppError(401, "AUTHORIZATION_ERROR", "Invalid token"));
    }
}