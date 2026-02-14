import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import UsuarioMaster from './usuario_master.js'

export default class Changelog extends BaseModel {
  static table = 'public.changelogs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare versao: string

  @column()
  declare titulo: string

  @column()
  declare descricao: string | null

  @column()
  declare tipo: 'recurso' | 'correcao' | 'melhoria' | 'seguranca'

  @column.date()
  declare dataLancamento: DateTime

  @column()
  declare criadoPor: number | null

  @column()
  declare ativo: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relacionamentos
  @belongsTo(() => UsuarioMaster, {
    foreignKey: 'criadoPor',
  })
  declare autor: BelongsTo<typeof UsuarioMaster>

  // Método para obter label do tipo
  get tipoLabel(): string {
    const labels: Record<string, string> = {
      recurso: 'Novo Recurso',
      correcao: 'Correção',
      melhoria: 'Melhoria',
      seguranca: 'Segurança',
    }
    return labels[this.tipo] || this.tipo
  }

  // Método para obter cor do badge
  get tipoCor(): string {
    const cores: Record<string, string> = {
      recurso: 'success',
      correcao: 'danger',
      melhoria: 'info',
      seguranca: 'warning',
    }
    return cores[this.tipo] || 'secondary'
  }
}
