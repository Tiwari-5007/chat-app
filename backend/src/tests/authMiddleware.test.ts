import { beforeEach, describe, expect, test, vi } from "vitest";
import { authMiddleware } from "../middlewares/authMiddleware";
import jwt from 'jsonwebtoken';
import { AppError } from "../errors/AppError";

describe('authMiddleware Test', () => {
    let req: any;
    let res: any;
    let next: any;
    let payload: { id: number, role: string };

    beforeEach(() => {
        process.env.JWT_SECRET = "TEST_SECRET";
        req = { headers: {}, user: undefined };
        res = {};
        next = vi.fn();
        payload = { id: 10, role: "user" };
    });

    test('Authorization header missing', () => {
        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(AppError));
        expect(next.mock.calls[0][0].message).toBe("Authorization header missing or malformed");
    });

    test("malformed Authorization header", () => {
        req.headers.authorization = "Invalid";

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith(
            expect.any(AppError)
        );
        expect(next.mock.calls[0][0].message).toBe(
            "Token missing"
        );
    });

    test("missing token", () => {
        req.headers.authorization = "Bearer ";

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith(
            expect.any(AppError)
        );
        expect(next.mock.calls[0][0].message).toBe(
            "Token missing"
        );
    });

    test("missing JWT_SECRET", () => {
        delete process.env.JWT_SECRET;
        req.headers.authorization = "Bearer sometoken";

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith(
            expect.any(AppError)
        );
        expect(next.mock.calls[0][0].message).toBe(
            "JWT_SECRET is not configured"
        );
    });

    test("invalid token", () => {
        req.headers.authorization = "Bearer badtoken";

        authMiddleware(req, res, next);

        expect(next).toHaveBeenCalledWith(
            expect.any(AppError)
        );
        expect(next.mock.calls[0][0].message).toBe(
            "Invalid token"
        );
    });


    test('valid token passes and sets req.user', () => {
        const token = jwt.sign(payload, "TEST_SECRET");

        req.headers.authorization = `Bearer ${token}`;

        authMiddleware(req, res, next);

        expect(req.user).toMatchObject(payload);
        expect(next).toHaveBeenCalled();
    });
});