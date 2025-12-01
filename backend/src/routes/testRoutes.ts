import { Router } from 'express';
import { Request, Response } from 'express';

const testRouter = Router();

testRouter.get('/test/users', async (req: Request, res: Response) => {
    const users = await getAllUsers();
    res.json({ status: "SUCCESS", message: "Users retrieved", data: users });
});

testRouter.get('/test/createUser', async (req: Request, res: Response) => {
    try {
        const userObj = {
            username: "testuser",
            name: "Test User",
            password: "password123",
            avatarUrl: ""
        };
        const user = await createUser(userObj.username, userObj.name, userObj.password, userObj.avatarUrl);
        res.json({ status: "SUCCESS", message: "User created", data: user });
    } catch (error) {
        console.log(error);
        res.json({ status: "FAILURE", message: "Error creating user", data: null });
    }
});

testRouter.get('/test', async (req: Request, res: Response) => {
    const { username } = req.query;
    if (!username) return res.json({ status: "FAILURE", message: "Username is required", data: null });

    const user = await findByUsername(username as string);
    if (!user) return res.json({ status: "FAILURE", message: "User not found", data: null });
    res.json({ status: "SUCCESS", message: "User found", data: user });
});

export default testRouter;