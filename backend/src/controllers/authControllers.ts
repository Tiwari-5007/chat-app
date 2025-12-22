import { NextFunction, Request, Response } from "express";
import { userService } from "../services/userServices";

const register = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = await userService.register(req.body);
        return res.status(201).json({
            status: "SUCCESS",
            data: {
                userId
            }
        });
    } catch (error) {
        next(error);
    }
}

const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = await userService.login(req.validated!.body);
        return res.status(200).json({
            status: 'SUCCESS',
            msg: "",
            data: {token}
        });
    } catch (error) {
        next(error);
    }
}

const logout = (req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(200).send("Success");
    } catch (error) {
        next(error);
    }
}

export { register, login, logout }