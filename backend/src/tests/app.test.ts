import { describe, test, expect, afterAll } from 'vitest';
import { createApp } from "../app";
import { prisma } from '../lib/prisma';
import request from 'supertest';

const app = createApp();

describe('Basic Server Test', () =>{
  afterAll(async () => {
    await prisma.$disconnect();
  })
  test('Should respond to GET /healthcheck', async () => {
    const res = await request(app).get('/healthcheck');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
