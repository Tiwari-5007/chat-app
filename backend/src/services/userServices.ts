import { AppError } from "../errors/AppError";
import { userRepo } from "../repository/userRepo";
import  bcrypt  from 'bcrypt';
import jwt from "jsonwebtoken";

export const userService = {
    async register(data: { username: string; name: string; password: string; avatarUrl?: string }) {
        
        // Create a check if username, name or password is not provided then throw an AppError
        if (!data.username || !data.name || !data.password) {
            throw new AppError(400, "MISSING_FIELDS", "Username, name, and password are required.");
        }

        const existingUser = await userRepo.findByUsername(data.username);
        if (existingUser) {
            throw new AppError(400, "USERNAME_ALREADY_EXISTS", "Username already Exists");
        }
        
        const hashedPassword = await bcrypt.hash(data.password, 10);
        const newUser = await userRepo.createUser({...data, password: hashedPassword});
        return newUser.id.toString();
    },

    async login(data: {username: string; password: string}) {
        const existingUser = await userRepo.findByUsername(data.username);
        
        if (!data.username || !data.password) {
            throw new AppError(400, "MISSING_CREDENTIALS", "Username and password are required.");
        }

        if(!existingUser) {
            throw new AppError(400,"INVALID_CREDENTIALS","Either Username or Password is wrong.");
        }

        const isPasswordValid = await bcrypt.compare(data.password, existingUser.password);
        if (!isPasswordValid) {
            throw new AppError(400,"INVALID_CREDENTIALS","Either Username or Password is wrong.");
        }

        const token = jwt.sign({ userId: existingUser.id }, process.env.JWT_SECRET || "default_secret", { expiresIn: "1h" });
        return token;
    }
}