import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import VotacaoService from '#services/votacao_service'

export default class PainelController {
  /**
   * Painel público da sessão (TV do plenário)
   * Acesso sem autenticação, via código da câmara
   */
  async publico({ params, view }: HttpContext) {
    const { codigo } = params

    // Busca município pelo código
    const municipio = await db.rawQuery(`
      SELECT * FROM municipios WHERE codigo = $1 OR slug = $1 AND ativo = true
    `, [codigo])

    if (municipio.rows.length === 0) {
      return view.render('pages/painel/nao-encontrado', {
        mensagem: 'Câmara não encontrada'
      })
    }

    const mun = municipio.rows[0]
    const schemaName = `camara_${mun.id}`

    // Busca sessão em andamento
    const sessaoResult = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.status = 'em_andamento'
      ORDER BY s.data DESC
      LIMIT 1
    `, [])

    if (sessaoResult.rows.length === 0) {
      return view.render('pages/painel/sem-sessao', {
        municipio: mun
      })
    }

    const sessao = sessaoResult.rows[0]

    // Busca vereadores com presença
    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.foto_url, v.cargo,
        p.sigla as partido_sigla, p.cor as partido_cor,
        COALESCE(sp.presente, false) as presente
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".sessao_presencas sp ON v.id = sp.vereador_id AND sp.sessao_id = $1
      WHERE v.status = 'ativo'
      ORDER BY v.nome_parlamentar, v.nome
    `, [sessao.id])

    // Estatísticas de quórum
    const totalVereadores = vereadores.rows.length
    const totalPresentes = vereadores.rows.filter((v: any) => v.presente).length
    const quorumMinimo = Math.floor(totalVereadores / 2) + 1

    // Busca votação em andamento
    const votacaoService = new VotacaoService(mun.id)
    const votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(sessao.id)

    let votosDetalhes: any[] = []
    let aguardandoVoto: any[] = []

    if (votacaoEmAndamento) {
      // Se nominal, busca votos
      if (votacaoEmAndamento.tipo === 'nominal') {
        const votosResult = await db.rawQuery(`
          SELECT vo.voto, ve.id as vereador_id, ve.nome, ve.nome_parlamentar, ve.foto_url,
            p.sigla as partido_sigla
          FROM "${schemaName}".votos vo
          JOIN "${schemaName}".vereadores ve ON vo.vereador_id = ve.id
          LEFT JOIN "${schemaName}".partidos p ON ve.partido_id = p.id
          WHERE vo.votacao_id = $1
          ORDER BY vo.hora_voto
        `, [votacaoEmAndamento.id])
        votosDetalhes = votosResult.rows
      }

      // Quem ainda não votou
      aguardandoVoto = await votacaoService.getVereadoresAguardando(
        votacaoEmAndamento.id,
        sessao.id
      )
    }

    // Busca vereador falando (se houver)
    const falando = await db.rawQuery(`
      SELECT i.*, v.nome, v.nome_parlamentar, v.foto_url, p.sigla as partido,
        tfc.duracao_segundos, tfc.nome as tipo_fala_nome
      FROM "${schemaName}".inscricoes_fala i
      JOIN "${schemaName}".vereadores v ON i.vereador_id = v.id
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".tempo_fala_config tfc ON i.tipo = tfc.tipo
      WHERE i.sessao_id = $1 AND i.status = 'falando'
      LIMIT 1
    `, [sessao.id])

    return view.render('pages/painel/publico', {
      municipio: mun,
      sessao,
      vereadores: vereadores.rows,
      quorum: {
        total: totalVereadores,
        presentes: totalPresentes,
        minimo: quorumMinimo,
        atingido: totalPresentes >= quorumMinimo
      },
      votacao: votacaoEmAndamento,
      votos: votosDetalhes,
      aguardandoVoto,
      falando: falando.rows[0] || null,
      contagem: votacaoEmAndamento ? {
        sim: votacaoEmAndamento.votos_sim || 0,
        nao: votacaoEmAndamento.votos_nao || 0,
        abstencao: votacaoEmAndamento.votos_abstencao || 0
      } : null
    })
  }

  /**
   * API: Estado do painel (para polling ou SSE)
   */
  async estado({ params, response }: HttpContext) {
    const { codigo } = params

    try {
      const municipio = await db.rawQuery(`
        SELECT * FROM municipios WHERE codigo = $1 OR slug = $1 AND ativo = true
      `, [codigo])

      if (municipio.rows.length === 0) {
        return response.status(404).json({ error: 'Câmara não encontrada' })
      }

      const mun = municipio.rows[0]
      const schemaName = `camara_${mun.id}`

      // Sessão
      const sessao = await db.rawQuery(`
        SELECT * FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        return response.json({ sessaoAtiva: false })
      }

      const sessaoId = sessao.rows[0].id

      // Quórum
      const quorumResult = await db.rawQuery(`
        SELECT
          (SELECT COUNT(*) FROM "${schemaName}".vereadores WHERE status = 'ativo') as total,
          (SELECT COUNT(*) FROM "${schemaName}".sessao_presencas WHERE sessao_id = $1 AND presente = true) as presentes
      `, [sessaoId])

      const total = parseInt(quorumResult.rows[0].total)
      const presentes = parseInt(quorumResult.rows[0].presentes)

      // Votação
      const votacaoService = new VotacaoService(mun.id)
      const votacao = await votacaoService.getVotacaoEmAndamento(sessaoId)

      let votos: any[] = []
      let aguardando: any[] = []

      if (votacao) {
        if (votacao.tipo === 'nominal') {
          const votosResult = await db.rawQuery(`
            SELECT vo.voto, ve.nome_parlamentar as nome, p.sigla as partido
            FROM "${schemaName}".votos vo
            JOIN "${schemaName}".vereadores ve ON vo.vereador_id = ve.id
            LEFT JOIN "${schemaName}".partidos p ON ve.partido_id = p.id
            WHERE vo.votacao_id = $1
          `, [votacao.id])
          votos = votosResult.rows
        }

        aguardando = await votacaoService.getVereadoresAguardando(votacao.id, sessaoId)
      }

      // Fala atual
      const falando = await db.rawQuery(`
        SELECT v.nome_parlamentar as nome, p.sigla as partido, i.tipo, i.hora_inicio_fala,
          tfc.duracao_segundos
        FROM "${schemaName}".inscricoes_fala i
        JOIN "${schemaName}".vereadores v ON i.vereador_id = v.id
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        LEFT JOIN "${schemaName}".tempo_fala_config tfc ON i.tipo = tfc.tipo
        WHERE i.sessao_id = $1 AND i.status = 'falando'
        LIMIT 1
      `, [sessaoId])

      return response.json({
        sessaoAtiva: true,
        sessao: {
          id: sessao.rows[0].id,
          numero: sessao.rows[0].numero,
          ano: sessao.rows[0].ano,
          tipo: sessao.rows[0].tipo,
          fase: sessao.rows[0].fase_atual
        },
        quorum: {
          total,
          presentes,
          minimo: Math.floor(total / 2) + 1,
          atingido: presentes >= Math.floor(total / 2) + 1
        },
        votacao: votacao ? {
          id: votacao.id,
          tipo: votacao.tipo,
          descricao: votacao.descricao,
          materia: votacao.materia_prefixo ?
            `${votacao.materia_prefixo} ${votacao.materia_numero}/${votacao.materia_ano}` : null,
          ementa: votacao.materia_ementa,
          contagem: {
            sim: votacao.votos_sim || 0,
            nao: votacao.votos_nao || 0,
            abstencao: votacao.votos_abstencao || 0
          }
        } : null,
        votos,
        aguardando: aguardando.map((v: any) => ({ nome: v.nome_parlamentar || v.nome, partido: v.partido })),
        falando: falando.rows[0] || null
      })
    } catch (error: any) {
      return response.status(500).json({ error: error.message })
    }
  }

  /**
   * Painel simplificado só com quórum
   */
  async quorum({ params, view }: HttpContext) {
    const { codigo } = params

    const municipio = await db.rawQuery(`
      SELECT * FROM municipios WHERE codigo = $1 OR slug = $1 AND ativo = true
    `, [codigo])

    if (municipio.rows.length === 0) {
      return view.render('pages/painel/nao-encontrado')
    }

    const mun = municipio.rows[0]
    const schemaName = `camara_${mun.id}`

    const sessao = await db.rawQuery(`
      SELECT * FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
    `, [])

    if (sessao.rows.length === 0) {
      return view.render('pages/painel/sem-sessao', { municipio: mun })
    }

    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.foto_url,
        p.sigla as partido_sigla, p.cor as partido_cor,
        COALESCE(sp.presente, false) as presente
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".sessao_presencas sp ON v.id = sp.vereador_id AND sp.sessao_id = $1
      WHERE v.status = 'ativo'
      ORDER BY v.nome_parlamentar, v.nome
    `, [sessao.rows[0].id])

    return view.render('pages/painel/quorum', {
      municipio: mun,
      sessao: sessao.rows[0],
      vereadores: vereadores.rows
    })
  }

  /**
   * Painel simplificado só com timer
   */
  async timer({ params, view }: HttpContext) {
    const { codigo } = params

    const municipio = await db.rawQuery(`
      SELECT * FROM municipios WHERE codigo = $1 OR slug = $1 AND ativo = true
    `, [codigo])

    if (municipio.rows.length === 0) {
      return view.render('pages/painel/nao-encontrado')
    }

    const mun = municipio.rows[0]
    const schemaName = `camara_${mun.id}`

    const sessao = await db.rawQuery(`
      SELECT * FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
    `, [])

    if (sessao.rows.length === 0) {
      return view.render('pages/painel/sem-sessao', { municipio: mun })
    }

    // Busca vereador falando
    const falando = await db.rawQuery(`
      SELECT i.*, v.nome, v.nome_parlamentar, v.foto_url, p.sigla as partido,
        tfc.duracao_segundos, tfc.nome as tipo_fala_nome
      FROM "${schemaName}".inscricoes_fala i
      JOIN "${schemaName}".vereadores v ON i.vereador_id = v.id
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".tempo_fala_config tfc ON i.tipo = tfc.tipo
      WHERE i.sessao_id = $1 AND i.status = 'falando'
      LIMIT 1
    `, [sessao.rows[0].id])

    // Próximos na fila
    const fila = await db.rawQuery(`
      SELECT i.*, v.nome, v.nome_parlamentar, p.sigla as partido
      FROM "${schemaName}".inscricoes_fala i
      JOIN "${schemaName}".vereadores v ON i.vereador_id = v.id
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      WHERE i.sessao_id = $1 AND i.status = 'aguardando'
      ORDER BY i.ordem
      LIMIT 5
    `, [sessao.rows[0].id])

    return view.render('pages/painel/timer', {
      municipio: mun,
      sessao: sessao.rows[0],
      falando: falando.rows[0] || null,
      fila: fila.rows
    })
  }
}
