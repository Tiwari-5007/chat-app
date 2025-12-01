import { Router } from 'express';
import { register, login, logout } from '../controllers/authControllers';
import { reqValidator } from '../middlewares/reqValidator';
import { loginSchema, registerSchema } from '../validators/auth';

const authRouter = Router();

authRouter.post(
    '/register',
    reqValidator(registerSchema),
    register
);
authRouter.post(
    '/login',
    reqValidator(loginSchema),
    login
);
// authRouter.post(
//     '/logout',
//     reqValidator(logoutSchema),
//     logout
// );

export default authRouter;