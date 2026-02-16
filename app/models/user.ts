import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Perfil from './perfil.js'
import Municipio from './municipio.js'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email', 'login'],
  passwordColumnName: 'senha',
})

export default class User extends compose(BaseModel, AuthFinder) {
  static table = 'usuarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nome: string

  @column()
  declare email: string

  @column()
  declare login: string

  @column({ serializeAs: null })
  declare senha: string

  @column()
  declare celular: string | null

  @column()
  declare perfilId: number

  @column()
  declare municipioId: number | null

  @column()
  declare foto: string | null

  @column()
  declare ativo: boolean

  @column()
  declare doisFatoresAtivo: boolean

  @column.dateTime()
  declare ultimoLogin: DateTime | null

  @column()
  declare ultimoMunicipioAcessado: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // Relacionamentos
  @belongsTo(() => Perfil)
  declare perfil: BelongsTo<typeof Perfil>

  @belongsTo(() => Municipio)
  declare municipio: BelongsTo<typeof Municipio>

  // Helpers
  get isSuperAdmin(): boolean {
    return this.perfilId === 1
  }

  get isPresidente(): boolean {
    return this.perfilId === 2
  }

  get isVereador(): boolean {
    return this.perfilId === 5
  }
}
