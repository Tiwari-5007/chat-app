import request from 'supertest';
import { server } from '../server';

describe('Basic Server Test', () => {
  afterAll((done) => {
    server.close(done);
  });

  it('should respond to GET / with a welcome message', async () => {
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('Chat app backend running!');
  });
});
