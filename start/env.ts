/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),
  TZ: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection (Central DB)
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | JWT Authentication
  |----------------------------------------------------------
  */
  JWT_SECRET: Env.schema.string.optional(),
  JWT_EXPIRES_IN: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | External Services
  |----------------------------------------------------------
  */
  DEEPFACE_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Employer data (Portaria 671)
  |----------------------------------------------------------
  */
  EMPREGADOR_RAZAO_SOCIAL: Env.schema.string.optional(),
  EMPREGADOR_CNPJ: Env.schema.string.optional(),
  EMPREGADOR_CEI: Env.schema.string.optional(),
  EMPREGADOR_ENDERECO: Env.schema.string.optional(),
  EMPREGADOR_CIDADE: Env.schema.string.optional(),
  EMPREGADOR_UF: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Device Sync Configuration
  |----------------------------------------------------------
  */
  SYNC_INTERVAL_MINUTES: Env.schema.number.optional(),
  DEVICE_TIMEOUT_MS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Storage Paths
  |----------------------------------------------------------
  */
  AFD_PATH: Env.schema.string.optional(),
  AEJ_PATH: Env.schema.string.optional(),
  LOG_PATH: Env.schema.string.optional(),
})
