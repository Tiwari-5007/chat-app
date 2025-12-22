import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma';
import { userRepo } from '../repository/userRepo';

describe('User Repository', () => {

  beforeAll(async () => {
    // Ensure the test DB is clean
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear users before each test
    await prisma.user.deleteMany();
  });

  test('should create a new user', async () => {
    const userData = { username: 'testuser', name: 'Test User', password: 'password123' };
    const newUser = await userRepo.createUser(userData);

    expect(newUser).toHaveProperty('id');
    expect(newUser.username).toBe(userData.username);
    expect(newUser.name).toBe(userData.name);
  });

  test('should find a user by username', async () => {
    const userData = { username: 'findme', name: 'Finder', password: 'password' };
    await userRepo.createUser(userData);

    const foundUser = await userRepo.findByUsername(userData.username);

    expect(foundUser).not.toBeNull();
    expect(foundUser!.username).toBe(userData.username);
    expect(foundUser!.name).toBe(userData.name);
  });

  test('should list all users', async () => {
    const users = [
      { username: 'user1', name: 'User One', password: 'pass1' },
      { username: 'user2', name: 'User Two', password: 'pass2' }
    ];

    for (const u of users) {
      await userRepo.createUser(u);
    }

    const userList = await userRepo.listUsers();

    expect(userList.length).toBe(2);
    expect(userList.map(u => u.username)).toEqual(expect.arrayContaining(['user1', 'user2']));
    expect(userList[0]).toHaveProperty('id');
    expect(userList[0]).not.toHaveProperty('password'); // listUsers doesn't select password
  });
});
