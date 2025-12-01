import { prisma } from "../lib/prisma";

export const userRepo = {
    findByUsername(username: string) {
        return prisma.user.findUnique({
            where: { username },
        });
    },

    listUsers() {
        return prisma.user.findMany({
            select: { id: true, username: true, name: true, avatarUrl: true }
        });
    },

    createUser(data: { username: string; name: string; password: string; avatarUrl?: string }) {
        return prisma.user.create({
            data
        });
    }
}