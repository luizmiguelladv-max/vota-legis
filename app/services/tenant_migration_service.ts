import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { dbManager } from './database_manager_service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Serviço de Migrations para Tenants
 *
 * Aplica o schema SQL nos bancos de dados de municípios
 */
export default class TenantMigrationService {
  private static schemaPath = join(__dirname, '../../database/migrations/tenant/schema_municipio.sql')

  /**
   * Aplica o schema completo em um banco de município
   */
  static async migrate(municipioId: number): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Iniciando migration para município ID: ${municipioId}`)

      // Lê o arquivo SQL
      const schema = await readFile(this.schemaPath, 'utf-8')

      // Obtém o pool do município
      const pool = await dbManager.getPoolMunicipio(municipioId)

      // Executa o schema
      await pool.query(schema)

      logger.info(`Migration concluída com sucesso para município ID: ${municipioId}`)
      return { success: true, message: 'Migration aplicada com sucesso' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
      logger.error(`Erro na migration do município ${municipioId}: ${errorMessage}`)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Verifica se o schema já foi aplicado
   */
  static async checkMigration(municipioId: number): Promise<boolean> {
    try {
      const result = await dbManager.queryMunicipio(
        municipioId,
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'funcionarios'
        ) as exists`
      )
      return result[0]?.exists === true
    } catch {
      return false
    }
  }

  /**
   * Aplica migration customizada (SQL adicional)
   */
  static async runCustomMigration(
    municipioId: number,
    sql: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Executando migration customizada para município ID: ${municipioId}`)

      const pool = await dbManager.getPoolMunicipio(municipioId)
      await pool.query(sql)

      logger.info(`Migration customizada concluída para município ID: ${municipioId}`)
      return { success: true, message: 'Migration customizada aplicada com sucesso' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
      logger.error(`Erro na migration customizada do município ${municipioId}: ${errorMessage}`)
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Lista tabelas do banco de um município
   */
  static async listTables(municipioId: number): Promise<string[]> {
    try {
      const result = await dbManager.queryMunicipio<{ table_name: string }>(
        municipioId,
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
         ORDER BY table_name`
      )
      return result.map((r) => r.table_name)
    } catch {
      return []
    }
  }
}
