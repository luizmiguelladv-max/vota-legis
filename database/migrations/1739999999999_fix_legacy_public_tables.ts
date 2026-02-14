import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // -----------------------------------------------------------------------
    // public.municipios (legacy -> new base)
    // -----------------------------------------------------------------------
    if (await this.schema.hasTable('municipios')) {
      // Add columns expected by the new base code (safe/no-op if they exist).
      const addMunicipiosCols = async () => {
        if (!(await this.schema.hasColumn('municipios', 'status_mensagem'))) {
          this.schema.alterTable('municipios', (table) => {
            table.text('status_mensagem').nullable()
          })
        }

        if (!(await this.schema.hasColumn('municipios', 'supabase_url'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('supabase_url', 500).nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'supabase_anon_key'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('supabase_anon_key', 500).nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'supabase_service_key'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('supabase_service_key', 500).nullable()
          })
        }

        if (!(await this.schema.hasColumn('municipios', 'db_connection_string'))) {
          this.schema.alterTable('municipios', (table) => {
            table.text('db_connection_string').nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'db_host'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('db_host', 255).nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'db_port'))) {
          this.schema.alterTable('municipios', (table) => {
            table.integer('db_port').nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'db_name'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('db_name', 100).nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'db_user'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('db_user', 100).nullable()
          })
        }
        if (!(await this.schema.hasColumn('municipios', 'db_password'))) {
          this.schema.alterTable('municipios', (table) => {
            table.string('db_password', 255).nullable()
          })
        }
      }

      await addMunicipiosCols()

      // Convert legacy boolean status -> text status.
      this.defer(async (db) => {
        const statusType = await db.rawQuery<{
          data_type: string
        }>(
          `
          select data_type
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'municipios'
            and column_name = 'status'
          limit 1
          `
        )

        const dataType = statusType.rows?.[0]?.data_type
        if (dataType === 'boolean') {
          // Legacy used boolean; map true -> 'ATIVO', false -> 'PENDENTE'
          await db.rawQuery(`
            alter table public.municipios
            alter column status type text
            using (case when status then 'ATIVO' else 'PENDENTE' end)
          `)
        }

        // If db_port exists but is NULL everywhere, set a sensible default.
        const hasDbPort = await db.rawQuery<{ exists: boolean }>(
          `
          select exists(
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'municipios'
              and column_name = 'db_port'
          ) as exists
          `
        )
        if (hasDbPort.rows?.[0]?.exists) {
          await db.rawQuery(`
            update public.municipios
            set db_port = 5432
            where db_port is null
          `)
        }
      })
    }

    // -----------------------------------------------------------------------
    // public.audit_logs (legacy -> middleware schema)
    // -----------------------------------------------------------------------
    if (await this.schema.hasTable('audit_logs')) {
      // Add missing columns used by app/middleware/audit_middleware.ts
      const addAuditCol = async (name: string, add: () => void) => {
        if (!(await this.schema.hasColumn('audit_logs', name))) {
          this.schema.alterTable('audit_logs', add)
        }
      }

      await addAuditCol('usuario_nome', (table) => {
        table.string('usuario_nome', 255).nullable()
      })
      await addAuditCol('usuario_email', (table) => {
        table.string('usuario_email', 255).nullable()
      })
      await addAuditCol('usuario_perfil', (table) => {
        table.string('usuario_perfil', 100).nullable()
      })

      await addAuditCol('entidade_id', (table) => {
        table.integer('entidade_id').unsigned().nullable()
      })
      await addAuditCol('entidade_nome', (table) => {
        table.string('entidade_nome', 255).nullable()
      })
      await addAuditCol('municipio_id', (table) => {
        table.integer('municipio_id').unsigned().nullable()
      })
      await addAuditCol('municipio_nome', (table) => {
        table.string('municipio_nome', 255).nullable()
      })

      await addAuditCol('metodo', (table) => {
        table.string('metodo', 10).nullable()
      })
      await addAuditCol('rota', (table) => {
        table.string('rota', 255).nullable()
      })
      await addAuditCol('url_completa', (table) => {
        table.text('url_completa').nullable()
      })
      await addAuditCol('ip_address', (table) => {
        table.string('ip_address', 45).nullable()
      })
      await addAuditCol('referer', (table) => {
        table.text('referer').nullable()
      })

      await addAuditCol('recurso', (table) => {
        table.string('recurso', 100).nullable()
      })
      await addAuditCol('recurso_id', (table) => {
        table.string('recurso_id', 50).nullable()
      })

      await addAuditCol('dados_request', (table) => {
        table.jsonb('dados_request').nullable()
      })
      await addAuditCol('query_params', (table) => {
        table.jsonb('query_params').nullable()
      })

      await addAuditCol('status_code', (table) => {
        table.integer('status_code').nullable()
      })
      await addAuditCol('sucesso', (table) => {
        table.boolean('sucesso').nullable()
      })
      await addAuditCol('mensagem_erro', (table) => {
        table.text('mensagem_erro').nullable()
      })
      await addAuditCol('stack_trace', (table) => {
        table.text('stack_trace').nullable()
      })
      await addAuditCol('duracao_ms', (table) => {
        table.integer('duracao_ms').nullable()
      })

      // Ensure created_at has a default so inserts that omit it won't fail.
      this.defer(async (db) => {
        await db.rawQuery(`
          alter table public.audit_logs
          alter column created_at set default now()
        `)
      })
    }
  }

  async down() {
    // Intentionally left empty. This migration is a forward-only repair of legacy tables.
  }
}

