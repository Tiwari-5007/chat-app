import { describe, test, expect, vi } from 'vitest';
import { reqValidator } from '../../src/middlewares/reqValidator';
import { z } from 'zod';
import { AppError } from '../../src/errors/AppError';

describe('reqValidator Middleware', () => {

  const schema = z.object({
    body: z.object({
      username: z.string(),
      password: z.string()
    })
  });

  test('should pass validation and attach validated data', () => {
    const middleware = reqValidator(schema);

    const req: any = {
      body: { username: 'yash', password: '123456' },
      params: {},
      query: {}
    };

    const res: any = {};

    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.validated.body.username).toBe('yash');
  });

  test('should fail validation and call next with AppError', () => {
    const middleware = reqValidator(schema);

    const req: any = {
      body: { username: 'yash' }, // missing password
      params: {},
      query: {}
    };

    const res: any = {};

    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const errorArg = next.mock.calls[0][0];

    expect(errorArg).toBeInstanceOf(AppError);
    expect(errorArg.code).toBe("VALIDATION_ERROR");
  });
});
