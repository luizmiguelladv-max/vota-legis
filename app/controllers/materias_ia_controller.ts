import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import GeminiService from '#services/gemini_service'

export default class MateriasIAController {
  /**
   * Página de criação de matéria com IA
   */
  async criar({ view, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!

    // Busca vereador vinculado ao usuário
    const vereador = await db.rawQuery(`
      SELECT v.*, p.sigla as partido_sigla, p.nome as partido_nome
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      WHERE v.usuario_id = $1 AND v.status = 'ativo'
    `, [user.id])

    // Busca tipos de matéria disponíveis
    const tiposMateria = await db.rawQuery(`
      SELECT * FROM "${schemaName}".tipos_materia 
      WHERE ativo = true 
      ORDER BY nome
    `, [])

    return view.render('pages/materias/criar-ia', {
      vereador: vereador.rows[0] || null,
      tiposMateria: tiposMateria.rows,
      municipio: tenant!.municipio
    })
  }

  /**
   * Gera matéria usando IA (API)
   */
  async gerar({ request, response, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const { tipo, descricao } = request.only(['tipo', 'descricao'])

    try {
      // Valida entrada
      if (!tipo || !descricao) {
        return response.status(400).json({
          success: false,
          error: 'Tipo e descrição são obrigatórios'
        })
      }

      if (descricao.length < 20) {
        return response.status(400).json({
          success: false,
          error: 'Descreva melhor o que deseja (mínimo 20 caracteres)'
        })
      }

      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT v.*, p.sigla as partido_sigla
        FROM "${schemaName}".vereadores v
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        WHERE v.usuario_id = $1 AND v.status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        return response.status(403).json({
          success: false,
          error: 'Usuário não é vereador ativo'
        })
      }

      const ver = vereador.rows[0]

      // Gera matéria com IA
      const materia = await GeminiService.gerarMateria({
        tipo,
        descricao,
        municipio: tenant!.municipio.nome,
        vereador: ver.nome_parlamentar || ver.nome,
        partido: ver.partido_sigla || ''
      })

      // Registra log da geração
      await db.rawQuery(`
        INSERT INTO "${schemaName}".materias_ia_log 
        (prompt_usuario, resposta_ia, modelo_ia, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [
        descricao,
        JSON.stringify(materia),
        'gemini-1.5-flash'
      ])

      return response.json({
        success: true,
        materia
      })
    } catch (error: any) {
      console.error('[MateriasIA] Erro ao gerar:', error)
      return response.status(500).json({
        success: false,
        error: error.message || 'Erro ao gerar matéria com IA'
      })
    }
  }

  /**
   * Salva matéria gerada
   */
  async salvar({ request, response, session, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const dados = request.only([
      'tipo_materia_id', 'ementa', 'texto', 'justificativa'
    ])

    try {
      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND v.status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        session.flash('error', 'Usuário não é vereador ativo')
        return response.redirect().back()
      }

      // Busca tipo de matéria para gerar número
      const tipoMateria = await db.rawQuery(`
        SELECT * FROM "${schemaName}".tipos_materia WHERE id = $1
      `, [dados.tipo_materia_id])

      if (tipoMateria.rows.length === 0) {
        session.flash('error', 'Tipo de matéria inválido')
        return response.redirect().back()
      }

      const tipo = tipoMateria.rows[0]
      const ano = new Date().getFullYear()

      // Gera próximo número
      const ultimaMateria = await db.rawQuery(`
        SELECT numero FROM "${schemaName}".materias 
        WHERE tipo_materia_id = $1 AND ano = $2
        ORDER BY numero DESC LIMIT 1
      `, [dados.tipo_materia_id, ano])

      const proximoNumero = ultimaMateria.rows.length > 0 
        ? parseInt(ultimaMateria.rows[0].numero) + 1 
        : 1

      // Insere matéria
      const result = await db.rawQuery(`
        INSERT INTO "${schemaName}".materias 
        (tipo_materia_id, numero, ano, ementa, texto, justificativa, autor_id, 
         situacao, origem, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'em_tramitacao', 'ia', NOW(), NOW())
        RETURNING id
      `, [
        dados.tipo_materia_id,
        proximoNumero,
        ano,
        dados.ementa,
        dados.texto,
        dados.justificativa,
        vereador.rows[0].id
      ])

      session.flash('success', `${tipo.prefixo} ${proximoNumero}/${ano} criado com sucesso!`)
      return response.redirect().toRoute('materias.show', { id: result.rows[0].id })
    } catch (error: any) {
      console.error('[MateriasIA] Erro ao salvar:', error)
      session.flash('error', error.message || 'Erro ao salvar matéria')
      return response.redirect().back()
    }
  }

  /**
   * Melhora texto de matéria existente
   */
  async melhorar({ request, response }: HttpContext) {
    const { texto, instrucoes } = request.only(['texto', 'instrucoes'])

    try {
      if (!texto) {
        return response.status(400).json({
          success: false,
          error: 'Texto é obrigatório'
        })
      }

      const textoMelhorado = await GeminiService.melhorarTexto(
        texto,
        instrucoes || 'Melhore a redação mantendo o sentido original'
      )

      return response.json({
        success: true,
        texto: textoMelhorado
      })
    } catch (error: any) {
      return response.status(500).json({
        success: false,
        error: error.message || 'Erro ao melhorar texto'
      })
    }
  }

  /**
   * Sugere ementa para matéria
   */
  async sugerirEmenta({ request, response }: HttpContext) {
    const { tipo, texto } = request.only(['tipo', 'texto'])

    try {
      if (!texto) {
        return response.status(400).json({
          success: false,
          error: 'Texto é obrigatório'
        })
      }

      const ementa = await GeminiService.sugerirEmenta(tipo || 'documento', texto)

      return response.json({
        success: true,
        ementa
      })
    } catch (error: any) {
      return response.status(500).json({
        success: false,
        error: error.message || 'Erro ao sugerir ementa'
      })
    }
  }

  /**
   * Gera ata de sessão automaticamente
   */
  async gerarAta({ params, response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { sessaoId } = params

    try {
      // Busca dados da sessão
      const sessao = await db.rawQuery(`
        SELECT * FROM "${schemaName}".sessoes WHERE id = $1
      `, [sessaoId])

      if (sessao.rows.length === 0) {
        return response.status(404).json({
          success: false,
          error: 'Sessão não encontrada'
        })
      }

      // Busca presenças
      const presencas = await db.rawQuery(`
        SELECT sp.presente, v.nome, v.nome_parlamentar, p.sigla as partido
        FROM "${schemaName}".sessao_presencas sp
        JOIN "${schemaName}".vereadores v ON sp.vereador_id = v.id
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        WHERE sp.sessao_id = $1
      `, [sessaoId])

      // Busca votações
      const votacoes = await db.rawQuery(`
        SELECT vo.*, m.ementa as materia, tm.prefixo, m.numero, m.ano
        FROM "${schemaName}".votacoes vo
        LEFT JOIN "${schemaName}".ordem_dia od ON vo.ordem_dia_id = od.id
        LEFT JOIN "${schemaName}".materias m ON od.materia_id = m.id
        LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
        WHERE vo.sessao_id = $1
        ORDER BY vo.numero_votacao
      `, [sessaoId])

      // Busca expedientes
      const expedientes = await db.rawQuery(`
        SELECT * FROM "${schemaName}".expedientes
        WHERE sessao_id = $1
        ORDER BY ordem
      `, [sessaoId])

      // Gera ata com IA
      const ata = await GeminiService.gerarAta({
        municipio: tenant!.municipio.nome,
        sessao: sessao.rows[0],
        presencas: presencas.rows,
        votacoes: votacoes.rows.map((v: any) => ({
          ...v,
          materia: v.prefixo ? `${v.prefixo} ${v.numero}/${v.ano} - ${v.materia}` : v.descricao
        })),
        falas: [], // TODO: implementar registro de falas
        expedientes: expedientes.rows
      })

      return response.json({
        success: true,
        ata
      })
    } catch (error: any) {
      console.error('[MateriasIA] Erro ao gerar ata:', error)
      return response.status(500).json({
        success: false,
        error: error.message || 'Erro ao gerar ata'
      })
    }
  }

  /**
   * Lista histórico de gerações com IA
   */
  async historico({ view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const logs = await db.rawQuery(`
      SELECT l.*, m.numero, m.ano, tm.prefixo,
        v.nome as vereador_nome, v.nome_parlamentar
      FROM "${schemaName}".materias_ia_log l
      LEFT JOIN "${schemaName}".materias m ON l.materia_id = m.id
      LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      LEFT JOIN "${schemaName}".vereadores v ON m.autor_id = v.id
      ORDER BY l.created_at DESC
      LIMIT 100
    `, [])

    return view.render('pages/materias/historico-ia', {
      logs: logs.rows
    })
  }
}
