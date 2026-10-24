import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  ADMIN_USERNAME: z.string().min(1, 'ADMIN_USERNAME is required'),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required'),
  NODE_ENV: z.string().default('development'),
  DB_PATH: z.string().default('./data/telemetry.sqlite'),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
