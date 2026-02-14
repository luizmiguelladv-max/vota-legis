import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ConfiguracaoGlobal extends BaseModel {
  static table = 'public.configuracoes_globais'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare chave: string

  @column()
  declare valor: string | null

  @column()
  declare descricao: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Método estático para obter configuração por chave
  static async getByKey(chave: string): Promise<string | null> {
    const config = await this.findBy('chave', chave)
    return config?.valor ?? null
  }

  // Método estático para definir configuração
  static async setByKey(chave: string, valor: string, descricao?: string): Promise<ConfiguracaoGlobal> {
    const config = await this.firstOrCreate(
      { chave },
      { chave, valor, descricao }
    )

    if (config.valor !== valor) {
      config.valor = valor
      if (descricao) {
        config.descricao = descricao
      }
      await config.save()
    }

    return config
  }

  // Método estático para obter todas as configurações como objeto
  static async getAllAsObject(): Promise<Record<string, string | null>> {
    const configs = await this.all()
    return configs.reduce(
      (acc, config) => {
        acc[config.chave] = config.valor
        return acc
      },
      {} as Record<string, string | null>
    )
  }
}
