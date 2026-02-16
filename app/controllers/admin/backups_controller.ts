import type { HttpContext } from '@adonisjs/core/http'
import BackupService from '#services/backup_service'
import AuditService from '#services/audit_service'
import Municipio from '#models/municipio'
import fs from 'fs/promises'

export default class BackupsController {
  /**
   * Lista todos os backups disponíveis
   */
  async listar({ response }: HttpContext) {
    try {
      const backups = await BackupService.listarBackups()
      const emAndamento = BackupService.obterBackupsEmAndamento()

      return response.json({
        success: true,
        backups,
        emAndamento,
      })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao listar backups:', error)
      return response.internalServerError({
        error: 'Erro ao listar backups',
        details: error.message,
      })
    }
  }

  /**
   * Cria um novo backup
   */
  async criar({ request, response, tenant }: HttpContext) {
    const { tipo, municipio_id } = request.only(['tipo', 'municipio_id'])

    try {
      let backup

      switch (tipo) {
        case 'completo':
          backup = await BackupService.criarBackupCompleto()
          break
        case 'municipio':
          if (!municipio_id) {
            return response.badRequest({ error: 'ID do município é obrigatório' })
          }
          backup = await BackupService.criarBackupMunicipio(Number(municipio_id))
          break
        case 'estrutura':
          backup = await BackupService.criarBackupEstrutura()
          break
        default:
          return response.badRequest({ error: 'Tipo de backup inválido' })
      }

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'BACKUP',
          descricao: `Backup ${tipo} criado: ${backup.nome}`,
          dadosNovos: { tipo, arquivo: backup.nome, tamanho: backup.tamanhoFormatado },
        }
      )

      return response.json({
        success: true,
        message: 'Backup criado com sucesso',
        backup,
      })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao criar backup:', error)
      return response.internalServerError({
        error: 'Erro ao criar backup',
        details: error.message,
      })
    }
  }

  /**
   * Exclui um backup
   */
  async excluir({ params, request, response, tenant }: HttpContext) {
    const { id } = params

    try {
      const sucesso = await BackupService.excluirBackup(id)

      if (!sucesso) {
        return response.notFound({ error: 'Backup não encontrado' })
      }

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'DELETE',
          tabela: 'backups',
          descricao: `Backup excluído: ${id}`,
        }
      )

      return response.json({
        success: true,
        message: 'Backup excluído com sucesso',
      })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao excluir backup:', error)
      return response.internalServerError({
        error: 'Erro ao excluir backup',
        details: error.message,
      })
    }
  }

  /**
   * Baixa um backup
   */
  async baixar({ params, response }: HttpContext) {
    const { id } = params

    try {
      const caminho = await BackupService.obterCaminhoBackup(id)

      if (!caminho) {
        return response.notFound({ error: 'Backup não encontrado' })
      }

      return response.download(caminho, true)
    } catch (error: any) {
      console.error('[BackupsController] Erro ao baixar backup:', error)
      return response.internalServerError({
        error: 'Erro ao baixar backup',
        details: error.message,
      })
    }
  }

  /**
   * Exporta dados de um município em JSON
   */
  async exportarMunicipio({ params, response }: HttpContext) {
    const { municipio_id } = params

    try {
      const dados = await BackupService.exportarDadosMunicipio(Number(municipio_id))

      response.header('Content-Type', 'application/json')
      response.header(
        'Content-Disposition',
        `attachment; filename="export_municipio_${municipio_id}_${Date.now()}.json"`
      )

      return response.send(JSON.stringify(dados, null, 2))
    } catch (error: any) {
      console.error('[BackupsController] Erro ao exportar município:', error)
      return response.internalServerError({
        error: 'Erro ao exportar dados do município',
        details: error.message,
      })
    }
  }

  /**
   * Lista municípios para seleção no backup
   */
  async listarMunicipios({ response }: HttpContext) {
    try {
      const municipios = await Municipio.query()
        .where('ativo', true)
        .orderBy('nome')
        .select('id', 'nome', 'uf')

      return response.json({ municipios })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao listar municípios:', error)
      return response.internalServerError({
        error: 'Erro ao listar municípios',
        details: error.message,
      })
    }
  }

  /**
   * Limpa backups antigos
   */
  async limpar({ request, response, tenant }: HttpContext) {
    const { manter } = request.only(['manter'])

    try {
      const excluidos = await BackupService.limparBackupsAntigos(Number(manter) || 5)

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'DELETE',
          tabela: 'backups',
          descricao: `Limpeza de backups antigos: ${excluidos} arquivos excluídos`,
        }
      )

      return response.json({
        success: true,
        message: `${excluidos} backup(s) antigo(s) excluído(s)`,
        excluidos,
      })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao limpar backups:', error)
      return response.internalServerError({
        error: 'Erro ao limpar backups',
        details: error.message,
      })
    }
  }

  /**
   * Obtém estatísticas de backups
   */
  async estatisticas({ response }: HttpContext) {
    try {
      const backups = await BackupService.listarBackups()

      const stats = {
        total: backups.length,
        porTipo: {
          completo: backups.filter((b) => b.tipo === 'COMPLETO').length,
          municipio: backups.filter((b) => b.tipo === 'MUNICIPIO').length,
          estrutura: backups.filter((b) => b.tipo === 'ESTRUTURA').length,
        },
        tamanhoTotal: backups.reduce((acc, b) => acc + b.tamanho, 0),
        ultimoBackup: backups.length > 0 ? backups[0].dataHora : null,
      }

      return response.json({ stats })
    } catch (error: any) {
      console.error('[BackupsController] Erro ao obter estatísticas:', error)
      return response.internalServerError({
        error: 'Erro ao obter estatísticas',
        details: error.message,
      })
    }
  }
}
