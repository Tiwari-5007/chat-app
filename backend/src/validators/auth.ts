import { z as zod } from 'zod';

export const registerSchema = zod.object({
    body: zod.object({
        username: zod
            .string()
            .nonempty("Username can not be empty")
            .min(5, "Username name must be at least 5 characters")
            .regex(
                /^[a-zA-Z0-9]+$/,
                "Username can only contain letters and numbers"
            ),

        name: zod
            .string()
            .trim()
            .nonempty("Username can not be empty")
            .min(2, "Name must be at least 4 characters"),

        password: zod
            .string()
            .nonempty("Password can not be empty")
            .min(6, "Password must be at least 6 characters"),

        avatarUrl: zod.string().optional(),
    }),
});

export const loginSchema = zod.object({
    body: zod.object({
        username: zod
            .string()
            .trim()
            .nonempty("Username can not be empty")
            .min(5, "Username name must be at least 5 characters")
            .regex(
                /^[a-zA-Z0-9]+$/,
                "Username can only contain letters and numbers"
            ),

        password: zod
            .string()
            .nonempty("Password can not be empty")
            .min(6, "Password must be at least 6 characters"),
    }),
});

// export const logoutSchema = zod.object({

// });