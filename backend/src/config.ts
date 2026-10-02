import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5433),
  DB_NAME: z.string().default('spotwhere'),
  DB_USER: z.string().default('spotwhere'),
  DB_PASSWORD: z.string().default('spotwhere_pass'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8080),
  GIGACHAT_KEY: z.string().optional(),
  GIGACHAT_SCOPE: z.string().default('GIGACHAT_API_PERS'),
  GIGACHAT_MODEL: z.string().default('GigaChat'),
  FRONTEND_DIR: z.string().default('../frontend'),
});

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  gigachat: { key: string; scope: string; model: string } | null;
  frontendDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  const user = encodeURIComponent(parsed.DB_USER);
  const password = encodeURIComponent(parsed.DB_PASSWORD);
  const key = parsed.GIGACHAT_KEY?.trim();
  return {
    databaseUrl:
      parsed.DATABASE_URL ??
      `postgres://${user}:${password}@${parsed.DB_HOST}:${parsed.DB_PORT}/${parsed.DB_NAME}`,
    host: parsed.HOST,
    port: parsed.PORT,
    gigachat: key ? { key, scope: parsed.GIGACHAT_SCOPE, model: parsed.GIGACHAT_MODEL } : null,
    frontendDir: parsed.FRONTEND_DIR,
  };
}
