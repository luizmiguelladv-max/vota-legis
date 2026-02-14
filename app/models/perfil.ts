import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class Perfil extends BaseModel {
  static table = 'perfis'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare codigo: string

  @column()
  declare nome: string

  @column()
  declare descricao: string | null

  @column()
  declare ativo: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // Relacionamentos
  @hasMany(() => User)
  declare usuarios: HasMany<typeof User>
}
