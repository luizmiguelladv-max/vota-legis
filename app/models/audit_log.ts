import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class AuditLog extends BaseModel {
  static table = 'public.audit_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare usuarioId: number | null

  @column()
  declare usuarioTipo: 'master' | 'municipal' | null

  @column()
  declare acao: string

  @column()
  declare tabela: string | null

  @column()
  declare registroId: number | null

  @column()
  declare dadosAnteriores: Record<string, any> | null

  @column()
  declare dadosNovos: Record<string, any> | null

  @column()
  declare ip: string | null

  @column()
  declare userAgent: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Método estático para criar log de auditoria
  static async registrar(params: {
    usuarioId?: number | null
    usuarioTipo?: 'master' | 'municipal'
    acao: string
    tabela?: string
    registroId?: number
    dadosAnteriores?: Record<string, any>
    dadosNovos?: Record<string, any>
    ip?: string
    userAgent?: string
  }): Promise<AuditLog> {
    return this.create({
      usuarioId: params.usuarioId ?? null,
      usuarioTipo: params.usuarioTipo ?? null,
      acao: params.acao,
      tabela: params.tabela ?? null,
      registroId: params.registroId ?? null,
      dadosAnteriores: params.dadosAnteriores ?? null,
      dadosNovos: params.dadosNovos ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    })
  }
}
