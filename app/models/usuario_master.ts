import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, beforeSave, hasMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LogOperacao from './log_operacao.js'
import Changelog from './changelog.js'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['login', 'email'],
  passwordColumnName: 'senha',
})

export default class UsuarioMaster extends compose(BaseModel, AuthFinder) {
  static table = 'public.usuarios_master'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare login: string

  @column({ serializeAs: null })
  declare senha: string

  @column()
  declare nome: string

  @column()
  declare email: string

  @column()
  declare ativo: boolean

  @column()
  declare telefone: string | null

  @column()
  declare doisFatoresAtivo: boolean

  @column.dateTime()
  declare ultimoAcesso: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Hook para hash da senha
  @beforeSave()
  static async hashPassword(user: UsuarioMaster) {
    if (user.$dirty.senha) {
      user.senha = await hash.make(user.senha)
    }
  }

  // Relacionamentos
  @hasMany(() => LogOperacao, {
    foreignKey: 'usuarioMasterId',
  })
  declare logsOperacoes: HasMany<typeof LogOperacao>

  @hasMany(() => Changelog, {
    foreignKey: 'criadoPor',
  })
  declare changelogs: HasMany<typeof Changelog>

  // Métodos auxiliares
  async verificarSenha(senha: string): Promise<boolean> {
    return hash.verify(this.senha, senha)
  }

  async atualizarUltimoAcesso(): Promise<void> {
    this.ultimoAcesso = DateTime.now()
    await this.save()
  }

  // Propriedade computada para indicar que é super admin
  get isSuperAdmin(): boolean {
    return true
  }
}
