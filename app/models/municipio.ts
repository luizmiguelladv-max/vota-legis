import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LogOperacao from './log_operacao.js'

export default class Municipio extends BaseModel {
  static table = 'public.municipios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare codigoIbge: string

  @column()
  declare nome: string

  @column()
  declare uf: string

  @column()
  declare slug: string

  @column()
  declare logoUrl: string | null

  @column()
  declare corPrimaria: string

  @column()
  declare corSecundaria: string

  @column()
  declare supabaseUrl: string | null

  @column()
  declare supabaseAnonKey: string | null

  @column({ serializeAs: null })
  declare supabaseServiceKey: string | null

  @column()
  declare dbConnectionString: string | null

  @column()
  declare dbHost: string | null

  @column()
  declare dbPort: number

  @column()
  declare dbName: string | null

  @column()
  declare dbUser: string | null

  @column({ serializeAs: null })
  declare dbPassword: string | null

  @column()
  declare dbSchema: string | null

  @column()
  declare status: 'PENDENTE' | 'CRIANDO' | 'ATIVO' | 'ERRO' | 'SUSPENSO'

  @column()
  declare statusMensagem: string | null

  @column()
  declare ativo: boolean

  // Configurações de módulos (vendidos separadamente)
  @column()
  declare moduloFacial: boolean

  @column()
  declare moduloDigital: boolean

  @column()
  declare syncIntervalSegundos: number

  // Configurações de implantação
  @column.date()
  declare dataInicioSistema: DateTime | null

  @column()
  declare modoManutencao: boolean

  @column()
  declare mensagemManutencao: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relacionamentos
  @hasMany(() => LogOperacao)
  declare logsOperacoes: HasMany<typeof LogOperacao>

  // Métodos auxiliares
  get isAtivo(): boolean {
    return this.ativo && this.status === 'ATIVO'
  }

  get connectionConfig() {
    if (this.dbConnectionString) {
      return { connectionString: this.dbConnectionString }
    }
    return {
      host: this.dbHost,
      port: this.dbPort,
      database: this.dbName,
      user: this.dbUser,
      password: this.dbPassword,
    }
  }
}
