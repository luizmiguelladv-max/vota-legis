import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class DashboardController {
  /**
   * Exibe o dashboard principal
   */
  async index({ view, tenant }: HttpContext) {
    const schemaName = tenant.schemaName

    let stats = {
      totalVereadores: 0,
      vereadoresAtivos: 0,
      sessoesAno: 0,
      materiasAno: 0,
      votacoesAno: 0,
      proximaSessao: null as any,
    }

    if (schemaName) {
      try {
        // Total de vereadores
        const vereadoresResult = await db.rawQuery(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'ativo') as ativos
          FROM "${schemaName}".vereadores
        `)
        stats.totalVereadores = parseInt(vereadoresResult.rows[0]?.total || '0')
        stats.vereadoresAtivos = parseInt(vereadoresResult.rows[0]?.ativos || '0')

        // Sessões do ano
        const anoAtual = new Date().getFullYear()
        const sessoesResult = await db.rawQuery(`
          SELECT COUNT(*) as total
          FROM "${schemaName}".sessoes
          WHERE ano = ?
        `, [anoAtual])
        stats.sessoesAno = parseInt(sessoesResult.rows[0]?.total || '0')

        // Matérias do ano
        const materiasResult = await db.rawQuery(`
          SELECT COUNT(*) as total
          FROM "${schemaName}".materias
          WHERE ano = ?
        `, [anoAtual])
        stats.materiasAno = parseInt(materiasResult.rows[0]?.total || '0')

        // Votações do ano
        const votacoesResult = await db.rawQuery(`
          SELECT COUNT(*) as total
          FROM "${schemaName}".votacoes v
          INNER JOIN "${schemaName}".sessoes s ON v.sessao_id = s.id
          WHERE s.ano = ?
        `, [anoAtual])
        stats.votacoesAno = parseInt(votacoesResult.rows[0]?.total || '0')

        // Próxima sessão agendada
        const proximaSessaoResult = await db.rawQuery(`
          SELECT *
          FROM "${schemaName}".sessoes
          WHERE status = 'agendada' AND data >= CURRENT_DATE
          ORDER BY data ASC
          LIMIT 1
        `)
        stats.proximaSessao = proximaSessaoResult.rows[0] || null
      } catch (error) {
        console.error('Erro ao carregar estatisticas:', error)
      }
    }

    return view.render('pages/dashboard', { stats })
  }
}
