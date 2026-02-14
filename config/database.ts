import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  /*
  |--------------------------------------------------------------------------
  | Default Connection
  |--------------------------------------------------------------------------
  |
  | The primary connection for making database queries across the application
  | This is the Central Database for multi-tenant management
  |
  */
  connection: 'postgres',

  connections: {
    /*
    |--------------------------------------------------------------------------
    | PostgreSQL - Central Database
    |--------------------------------------------------------------------------
    |
    | Database that manages municipalities, master users, global settings
    | and audit logs across all tenants
    |
    */
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
        ssl: env.get('DB_SSL') ? { rejectUnauthorized: false } : false,
      },
      searchPath: ['public'],
      pool: {
        min: 2,
        max: 20,
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      seeders: {
        paths: ['database/seeders'],
      },
      healthCheck: true,
      debug: env.get('NODE_ENV') === 'development',
    },
  },
})

export default dbConfig