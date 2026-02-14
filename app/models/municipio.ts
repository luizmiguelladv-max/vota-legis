import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class Municipio extends BaseModel {
  static table = 'municipios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare slug: string

  @column()
  declare uf: string

  @column({ columnName: 'codigo_ibge' })
  declare codigoIbge: string | null

  @column()
  declare ativo: boolean

  @column()
  declare status: boolean

  @column({ columnName: 'banco_criado' })
  declare bancoCriado: boolean

  // Dados da camara
  @column()
  declare cnpj: string | null

  @column()
  declare endereco: string | null

  @column()
  declare telefone: string | null

  @column()
  declare email: string | null

  @column()
  declare site: string | null

  @column()
  declare cep: string | null

  @column()
  declare populacao: number | null

  @column()
  declare observacoes: string | null

  @column()
  declare latitude: string | null

  @column()
  declare longitude: string | null

  // Visual
  @column({ columnName: 'logo_url' })
  declare logoUrl: string | null

  @column({ columnName: 'cor_primaria' })
  declare corPrimaria: string

  @column({ columnName: 'cor_secundaria' })
  declare corSecundaria: string

  @column({ columnName: 'total_vereadores' })
  declare totalVereadores: number

  @column.dateTime({ autoCreate: true, columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime | null

  // Relacionamentos
  @hasMany(() => User)
  declare usuarios: HasMany<typeof User>

  // Helpers
  get isAtivo(): boolean {
    return this.ativo && this.status
  }

  get schemaName(): string {
    return `camara_${this.id}`
  }
}
