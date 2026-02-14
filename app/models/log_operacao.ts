import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Municipio from './municipio.js'
import UsuarioMaster from './usuario_master.js'

export default class LogOperacao extends BaseModel {
  static table = 'public.logs_operacoes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare municipioId: number | null

  @column()
  declare usuarioMasterId: number | null

  @column()
  declare operacao: 'CRIAR_BANCO' | 'MIGRATION' | 'BACKUP' | 'RESTORE' | 'SINCRONIZACAO' | 'CONFIGURACAO'

  @column()
  declare status: 'INICIADO' | 'SUCESSO' | 'ERRO'

  @column()
  declare detalhes: Record<string, any> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Relacionamentos
  @belongsTo(() => Municipio)
  declare municipio: BelongsTo<typeof Municipio>

  @belongsTo(() => UsuarioMaster, {
    foreignKey: 'usuarioMasterId',
  })
  declare usuarioMaster: BelongsTo<typeof UsuarioMaster>

  // Método estático para criar log de operação
  static async registrar(
    operacao: LogOperacao['operacao'],
    status: LogOperacao['status'],
    detalhes?: Record<string, any>,
    municipioId?: number,
    usuarioMasterId?: number
  ): Promise<LogOperacao> {
    return this.create({
      operacao,
      status,
      detalhes,
      municipioId,
      usuarioMasterId,
    })
  }
}
