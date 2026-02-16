import type { HttpContext } from '@adonisjs/core/http'
import RelatorioService from '#services/relatorio_service'
import EspelhoPontoService from '#services/espelho_ponto_service'
import AuditService from '#services/audit_service'
import DatabaseManagerService from '#services/database_manager_service'
import { DateTime } from 'luxon'

export default class RelatoriosController {
  /**
   * Gera e baixa arquivo AFD (Arquivo Fonte de Dados)
   * Conforme Portaria 671/2021 do MTE
   */
  async gerarAFD({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { data_inicio, data_fim } = request.only(['data_inicio', 'data_fim'])

    if (!data_inicio || !data_fim) {
      return response.badRequest({ error: 'Data inicial e final são obrigatórias' })
    }

    try {
      const dataInicio = DateTime.fromISO(data_inicio).startOf('day').toJSDate()
      const dataFim = DateTime.fromISO(data_fim).endOf('day').toJSDate()

      // Busca dados do empregador (unidade gestora principal ou município)
      const empregador = await this.buscarDadosEmpregador(tenant.municipioId)

      // Gera o arquivo AFD
      const conteudo = await RelatorioService.gerarAFD(
        tenant.municipioId,
        dataInicio,
        dataFim,
        empregador
      )

      // Gera nome do arquivo
      const nomeArquivo = RelatorioService.gerarNomeArquivoAFD(
        empregador.identificador,
        dataInicio,
        dataFim
      )

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'EXPORT',
          descricao: `Exportação AFD: ${data_inicio} a ${data_fim}`,
        }
      )

      // Retorna arquivo para download
      response.header('Content-Type', 'text/plain; charset=utf-8')
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)

      return response.send(conteudo)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar AFD:', error)
      return response.internalServerError({
        error: 'Erro ao gerar arquivo AFD',
        details: error.message,
      })
    }
  }

  /**
   * Gera e baixa arquivo AEJ (Arquivo Eletrônico de Jornada)
   * Conforme Portaria 671/2021 do MTE
   */
  async gerarAEJ({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { data_inicio, data_fim } = request.only(['data_inicio', 'data_fim'])

    if (!data_inicio || !data_fim) {
      return response.badRequest({ error: 'Data inicial e final são obrigatórias' })
    }

    try {
      const dataInicio = DateTime.fromISO(data_inicio).startOf('day').toJSDate()
      const dataFim = DateTime.fromISO(data_fim).endOf('day').toJSDate()

      // Busca dados do empregador
      const empregador = await this.buscarDadosEmpregador(tenant.municipioId)

      // Gera o arquivo AEJ
      const conteudo = await RelatorioService.gerarAEJ(
        tenant.municipioId,
        dataInicio,
        dataFim,
        empregador
      )

      // Gera nome do arquivo
      const nomeArquivo = RelatorioService.gerarNomeArquivoAEJ(
        empregador.identificador,
        dataInicio,
        dataFim
      )

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'EXPORT',
          descricao: `Exportação AEJ: ${data_inicio} a ${data_fim}`,
        }
      )

      // Retorna arquivo para download
      response.header('Content-Type', 'text/plain; charset=utf-8')
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)

      return response.send(conteudo)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar AEJ:', error)
      return response.internalServerError({
        error: 'Erro ao gerar arquivo AEJ',
        details: error.message,
      })
    }
  }

  /**
   * Busca dados do empregador para os relatórios
   */
  private async buscarDadosEmpregador(municipioId: number): Promise<{
    tipo_identificador: number
    identificador: string
    cei: string
    razao_social: string
    local: string
  }> {
    // Primeiro tenta buscar a unidade gestora principal
    const queryUG = `
      SELECT codigo, nome, cnpj
      FROM unidades_gestoras
      WHERE ativo = true
      ORDER BY id ASC
      LIMIT 1
    `

    const resultUG = await DatabaseManagerService.queryMunicipio(municipioId, queryUG)

    if (resultUG.rows.length > 0 && resultUG.rows[0].cnpj) {
      const ug = resultUG.rows[0]
      return {
        tipo_identificador: 1, // CNPJ
        identificador: ug.cnpj.replace(/\D/g, ''),
        cei: '',
        razao_social: ug.nome,
        local: '',
      }
    }

    // Se não encontrar, usa dados do município
    const Municipio = (await import('#models/municipio')).default
    const municipio = await Municipio.find(municipioId)

    if (!municipio) {
      throw new Error('Município não encontrado')
    }

    return {
      tipo_identificador: 1,
      identificador: '00000000000000', // CNPJ padrão se não tiver
      cei: '',
      razao_social: `PREFEITURA MUNICIPAL DE ${municipio.nome.toUpperCase()}`,
      local: `${municipio.nome}/${municipio.uf}`,
    }
  }

  /**
   * Gera espelho de ponto em PDF
   */
  async gerarEspelhoPDF({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano } = request.only(['funcionario_id', 'mes', 'ano'])

    if (!funcionario_id || !mes || !ano) {
      return response.badRequest({ error: 'Funcionário, mês e ano são obrigatórios' })
    }

    try {
      const pdfBuffer = await EspelhoPontoService.gerarPDF(
        tenant.municipioId,
        Number(funcionario_id),
        Number(mes),
        Number(ano)
      )

      const nomeArquivo = `Espelho_Ponto_${funcionario_id}_${mes}_${ano}.pdf`

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'EXPORT',
          descricao: `Exportação Espelho de Ponto PDF: Funcionário ${funcionario_id}, ${mes}/${ano}`,
        }
      )

      response.header('Content-Type', 'application/pdf')
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)

      return response.send(pdfBuffer)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Espelho PDF:', error)
      return response.internalServerError({
        error: 'Erro ao gerar espelho de ponto',
        details: error.message,
      })
    }
  }

  /**
   * Gera espelho de ponto em Excel
   */
  async gerarEspelhoExcel({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano } = request.only(['funcionario_id', 'mes', 'ano'])

    if (!funcionario_id || !mes || !ano) {
      return response.badRequest({ error: 'Funcionário, mês e ano são obrigatórios' })
    }

    try {
      const excelBuffer = await EspelhoPontoService.gerarExcel(
        tenant.municipioId,
        Number(funcionario_id),
        Number(mes),
        Number(ano)
      )

      const nomeArquivo = `Espelho_Ponto_${funcionario_id}_${mes}_${ano}.xlsx`

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'EXPORT',
          descricao: `Exportação Espelho de Ponto Excel: Funcionário ${funcionario_id}, ${mes}/${ano}`,
        }
      )

      response.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)

      return response.send(excelBuffer)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Espelho Excel:', error)
      return response.internalServerError({
        error: 'Erro ao gerar espelho de ponto',
        details: error.message,
      })
    }
  }

  /**
   * Lista relatórios disponíveis
   */
  async listar({ response }: HttpContext) {
    const relatorios = [
      {
        id: 'afd',
        nome: 'AFD - Arquivo Fonte de Dados',
        descricao: 'Arquivo com todas as marcações de ponto conforme Portaria 671/2021',
        formato: 'TXT',
        parametros: ['data_inicio', 'data_fim'],
      },
      {
        id: 'aej',
        nome: 'AEJ - Arquivo Eletrônico de Jornada',
        descricao: 'Arquivo com jornadas dos trabalhadores conforme Portaria 671/2021',
        formato: 'TXT',
        parametros: ['data_inicio', 'data_fim'],
      },
      {
        id: 'espelho-pdf',
        nome: 'Espelho de Ponto (PDF)',
        descricao: 'Relatório mensal de ponto do funcionário em PDF',
        formato: 'PDF',
        parametros: ['funcionario_id', 'mes', 'ano'],
      },
      {
        id: 'espelho-excel',
        nome: 'Espelho de Ponto (Excel)',
        descricao: 'Relatório mensal de ponto do funcionário em Excel',
        formato: 'XLSX',
        parametros: ['funcionario_id', 'mes', 'ano'],
      },
      {
        id: 'frequencia',
        nome: 'Relatório de Frequência',
        descricao: 'Frequência mensal dos funcionários',
        formato: 'PDF/XLSX',
        parametros: ['mes', 'ano', 'funcionario_id', 'lotacao_id'],
      },
      {
        id: 'horas-extras',
        nome: 'Relatório de Horas Extras',
        descricao: 'Horas extras trabalhadas no período',
        formato: 'PDF/XLSX',
        parametros: ['data_inicio', 'data_fim', 'funcionario_id', 'lotacao_id'],
      },
      {
        id: 'ocorrencias',
        nome: 'Relatório de Ocorrências',
        descricao: 'Faltas, atestados e afastamentos',
        formato: 'PDF/XLSX',
        parametros: ['data_inicio', 'data_fim', 'funcionario_id', 'tipo_ocorrencia_id'],
      },
      {
        id: 'banco-horas',
        nome: 'Banco de Horas',
        descricao: 'Saldo de banco de horas dos funcionários',
        formato: 'PDF/XLSX',
        parametros: ['mes', 'ano', 'funcionario_id', 'lotacao_id'],
      },
      {
        id: 'funcionarios-excel',
        nome: 'Lista de Funcionários',
        descricao: 'Exportação da lista de funcionários',
        formato: 'XLSX',
        parametros: ['lotacao_id', 'ativo'],
      },
    ]

    return response.json({ relatorios })
  }

  /**
   * Gera relatório de frequência
   */
  async gerarFrequencia({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { mes, ano, funcionario_id, lotacao_id, formato } = request.only([
      'mes',
      'ano',
      'funcionario_id',
      'lotacao_id',
      'formato',
    ])

    if (!mes || !ano) {
      return response.badRequest({ error: 'Mês e ano são obrigatórios' })
    }

    try {
      const dados = await RelatorioService.gerarFrequencia(
        tenant.municipioId,
        Number(mes),
        Number(ano),
        funcionario_id ? Number(funcionario_id) : undefined,
        lotacao_id ? Number(lotacao_id) : undefined
      )

      // Registra auditoria
      await AuditService.logFromContext({ request, tenant } as HttpContext, {
        acao: 'EXPORT',
        descricao: `Relatório de Frequência: ${mes}/${ano}`,
      })

      if (formato === 'excel') {
        // Gera Excel
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Frequência')

        // Cabeçalho
        sheet.mergeCells('A1:L1')
        sheet.getCell('A1').value = `RELATÓRIO DE FREQUÊNCIA - ${dados.periodo.mesNome.toUpperCase()}`
        sheet.getCell('A1').font = { bold: true, size: 14 }
        sheet.getCell('A1').alignment = { horizontal: 'center' }

        // Colunas
        sheet.columns = [
          { header: 'Matrícula', key: 'matricula', width: 12 },
          { header: 'Nome', key: 'nome', width: 35 },
          { header: 'Cargo', key: 'cargo', width: 25 },
          { header: 'Lotação', key: 'lotacao', width: 25 },
          { header: 'Dias Úteis', key: 'diasUteis', width: 12 },
          { header: 'Presenças', key: 'presencas', width: 12 },
          { header: 'Faltas', key: 'faltas', width: 10 },
          { header: 'Abonos', key: 'abonos', width: 10 },
          { header: 'Horas Trab.', key: 'horasTrabalhadas', width: 12 },
          { header: 'Horas Extras', key: 'horasExtras', width: 12 },
          { header: '% Presença', key: 'percentualPresenca', width: 12 },
        ]

        const headerRow = sheet.getRow(3)
        headerRow.values = [
          'Matrícula',
          'Nome',
          'Cargo',
          'Lotação',
          'Dias Úteis',
          'Presenças',
          'Faltas',
          'Abonos',
          'Horas Trab.',
          'Horas Extras',
          '% Presença',
        ]
        headerRow.font = { bold: true }
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

        let row = 4
        for (const func of dados.funcionarios) {
          sheet.getRow(row).values = [
            func.matricula,
            func.nome,
            func.cargo,
            func.lotacao,
            func.diasUteis,
            func.presencas,
            func.faltas,
            func.abonos,
            func.horasTrabalhadas,
            func.horasExtras,
            `${func.percentualPresenca}%`,
          ]
          row++
        }

        // Resumo
        row += 2
        sheet.getCell(`A${row}`).value = 'RESUMO'
        sheet.getCell(`A${row}`).font = { bold: true }
        row++
        sheet.getCell(`A${row}`).value = `Total de Funcionários: ${dados.resumo.totalFuncionarios}`
        sheet.getCell(`D${row}`).value = `Média de Presença: ${dados.resumo.mediaPresenca}%`
        row++
        sheet.getCell(`A${row}`).value = `Total Presenças: ${dados.resumo.totalPresencas}`
        sheet.getCell(`D${row}`).value = `Total Faltas: ${dados.resumo.totalFaltas}`

        const buffer = await workbook.xlsx.writeBuffer()
        const nomeArquivo = `Frequencia_${mes}_${ano}.xlsx`

        response.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        return response.send(Buffer.from(buffer))
      }

      // Retorna JSON (pode ser usado para gerar PDF no frontend ou preview)
      return response.json(dados)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Frequência:', error)
      return response.internalServerError({
        error: 'Erro ao gerar relatório de frequência',
        details: error.message,
      })
    }
  }

  /**
   * Gera relatório de horas extras
   */
  async gerarHorasExtras({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { data_inicio, data_fim, funcionario_id, lotacao_id, formato } = request.only([
      'data_inicio',
      'data_fim',
      'funcionario_id',
      'lotacao_id',
      'formato',
    ])

    if (!data_inicio || !data_fim) {
      return response.badRequest({ error: 'Data inicial e final são obrigatórias' })
    }

    try {
      const dataInicio = DateTime.fromISO(data_inicio).startOf('day').toJSDate()
      const dataFim = DateTime.fromISO(data_fim).endOf('day').toJSDate()

      const dados = await RelatorioService.gerarHorasExtras(
        tenant.municipioId,
        dataInicio,
        dataFim,
        funcionario_id ? Number(funcionario_id) : undefined,
        lotacao_id ? Number(lotacao_id) : undefined
      )

      // Registra auditoria
      await AuditService.logFromContext({ request, tenant } as HttpContext, {
        acao: 'EXPORT',
        descricao: `Relatório de Horas Extras: ${data_inicio} a ${data_fim}`,
      })

      if (formato === 'excel') {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Horas Extras')

        sheet.mergeCells('A1:I1')
        sheet.getCell('A1').value = `RELATÓRIO DE HORAS EXTRAS - ${dados.periodo.dataInicio} a ${dados.periodo.dataFim}`
        sheet.getCell('A1').font = { bold: true, size: 14 }
        sheet.getCell('A1').alignment = { horizontal: 'center' }

        const headerRow = sheet.getRow(3)
        headerRow.values = [
          'Matrícula',
          'Nome',
          'Cargo',
          'Lotação',
          'Jornada',
          'HE 50%',
          'HE 100%',
          'Total HE',
        ]
        headerRow.font = { bold: true }
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

        let row = 4
        for (const reg of dados.registros) {
          sheet.getRow(row).values = [
            reg.matricula,
            reg.nome,
            reg.cargo,
            reg.lotacao,
            reg.jornada,
            reg.horasExtras50,
            reg.horasExtras100,
            reg.totalHorasExtras,
          ]
          row++
        }

        // Resumo
        row += 2
        sheet.getCell(`A${row}`).value = 'RESUMO'
        sheet.getCell(`A${row}`).font = { bold: true }
        row++
        sheet.getCell(`A${row}`).value = `Funcionários com HE: ${dados.resumo.totalFuncionarios}`
        row++
        sheet.getCell(`A${row}`).value = `Total HE 50%: ${dados.resumo.totalHorasExtras50}h`
        sheet.getCell(`D${row}`).value = `Total HE 100%: ${dados.resumo.totalHorasExtras100}h`
        row++
        sheet.getCell(`A${row}`).value = `Total Geral: ${dados.resumo.totalGeralHorasExtras}h`
        sheet.getCell(`A${row}`).font = { bold: true }

        const buffer = await workbook.xlsx.writeBuffer()
        const nomeArquivo = `HorasExtras_${data_inicio}_${data_fim}.xlsx`

        response.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        return response.send(Buffer.from(buffer))
      }

      return response.json(dados)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Horas Extras:', error)
      return response.internalServerError({
        error: 'Erro ao gerar relatório de horas extras',
        details: error.message,
      })
    }
  }

  /**
   * Gera relatório de ocorrências
   */
  async gerarOcorrencias({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { data_inicio, data_fim, funcionario_id, tipo_ocorrencia_id, lotacao_id, formato } =
      request.only([
        'data_inicio',
        'data_fim',
        'funcionario_id',
        'tipo_ocorrencia_id',
        'lotacao_id',
        'formato',
      ])

    if (!data_inicio || !data_fim) {
      return response.badRequest({ error: 'Data inicial e final são obrigatórias' })
    }

    try {
      const dataInicio = DateTime.fromISO(data_inicio).startOf('day').toJSDate()
      const dataFim = DateTime.fromISO(data_fim).endOf('day').toJSDate()

      const dados = await RelatorioService.gerarOcorrencias(
        tenant.municipioId,
        dataInicio,
        dataFim,
        funcionario_id ? Number(funcionario_id) : undefined,
        tipo_ocorrencia_id ? Number(tipo_ocorrencia_id) : undefined,
        lotacao_id ? Number(lotacao_id) : undefined
      )

      // Registra auditoria
      await AuditService.logFromContext({ request, tenant } as HttpContext, {
        acao: 'EXPORT',
        descricao: `Relatório de Ocorrências: ${data_inicio} a ${data_fim}`,
      })

      if (formato === 'excel') {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Ocorrências')

        sheet.mergeCells('A1:J1')
        sheet.getCell('A1').value = `RELATÓRIO DE OCORRÊNCIAS - ${dados.periodo.dataInicio} a ${dados.periodo.dataFim}`
        sheet.getCell('A1').font = { bold: true, size: 14 }
        sheet.getCell('A1').alignment = { horizontal: 'center' }

        const headerRow = sheet.getRow(3)
        headerRow.values = [
          'Matrícula',
          'Nome',
          'Lotação',
          'Tipo',
          'Data Início',
          'Data Fim',
          'Dias',
          'Abona',
          'Observação',
        ]
        headerRow.font = { bold: true }
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

        let row = 4
        for (const oc of dados.ocorrencias) {
          sheet.getRow(row).values = [
            oc.matricula,
            oc.funcionarioNome,
            oc.lotacao,
            oc.tipoNome,
            oc.dataInicio,
            oc.dataFim,
            oc.dias,
            oc.abona ? 'Sim' : 'Não',
            oc.observacao,
          ]
          row++
        }

        // Resumo por tipo
        row += 2
        sheet.getCell(`A${row}`).value = 'RESUMO POR TIPO'
        sheet.getCell(`A${row}`).font = { bold: true }
        row++
        for (const tipo of dados.resumoPorTipo) {
          sheet.getCell(`A${row}`).value = tipo.tipo
          sheet.getCell(`C${row}`).value = `${tipo.quantidade} ocorrência(s)`
          sheet.getCell(`E${row}`).value = `${tipo.diasTotal} dia(s)`
          row++
        }

        // Resumo geral
        row++
        sheet.getCell(`A${row}`).value = 'RESUMO GERAL'
        sheet.getCell(`A${row}`).font = { bold: true }
        row++
        sheet.getCell(`A${row}`).value = `Total: ${dados.resumo.totalOcorrencias} ocorrências, ${dados.resumo.totalDias} dias`

        const buffer = await workbook.xlsx.writeBuffer()
        const nomeArquivo = `Ocorrencias_${data_inicio}_${data_fim}.xlsx`

        response.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        return response.send(Buffer.from(buffer))
      }

      return response.json(dados)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Ocorrências:', error)
      return response.internalServerError({
        error: 'Erro ao gerar relatório de ocorrências',
        details: error.message,
      })
    }
  }

  /**
   * Gera relatório de banco de horas
   */
  async gerarBancoHoras({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { mes, ano, funcionario_id, lotacao_id, formato } = request.only([
      'mes',
      'ano',
      'funcionario_id',
      'lotacao_id',
      'formato',
    ])

    if (!mes || !ano) {
      return response.badRequest({ error: 'Mês e ano são obrigatórios' })
    }

    try {
      const dados = await RelatorioService.gerarBancoHoras(
        tenant.municipioId,
        Number(mes),
        Number(ano),
        funcionario_id ? Number(funcionario_id) : undefined,
        lotacao_id ? Number(lotacao_id) : undefined
      )

      // Registra auditoria
      await AuditService.logFromContext({ request, tenant } as HttpContext, {
        acao: 'EXPORT',
        descricao: `Relatório de Banco de Horas: ${mes}/${ano}`,
      })

      if (formato === 'excel') {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Banco de Horas')

        sheet.mergeCells('A1:J1')
        sheet.getCell('A1').value = `BANCO DE HORAS - ${dados.periodo.mesNome.toUpperCase()}`
        sheet.getCell('A1').font = { bold: true, size: 14 }
        sheet.getCell('A1').alignment = { horizontal: 'center' }

        const headerRow = sheet.getRow(3)
        headerRow.values = [
          'Matrícula',
          'Nome',
          'Cargo',
          'Lotação',
          'Jornada',
          'Horas Prev.',
          'Horas Trab.',
          'Saldo Ant.',
          'Saldo Mês',
          'Saldo Atual',
        ]
        headerRow.font = { bold: true }
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

        let row = 4
        for (const func of dados.funcionarios) {
          const r = sheet.getRow(row)
          r.values = [
            func.matricula,
            func.nome,
            func.cargo,
            func.lotacao,
            func.jornada,
            func.horasPrevistas,
            func.horasTrabalhadas,
            func.saldoAnterior,
            func.saldoMes,
            func.saldoAtual,
          ]

          // Cor baseada no saldo
          if (func.saldoAtual < 0) {
            r.getCell(10).font = { color: { argb: 'FFFF0000' } }
          } else if (func.saldoAtual > 0) {
            r.getCell(10).font = { color: { argb: 'FF008000' } }
          }

          row++
        }

        // Resumo
        row += 2
        sheet.getCell(`A${row}`).value = 'RESUMO'
        sheet.getCell(`A${row}`).font = { bold: true }
        row++
        sheet.getCell(`A${row}`).value = `Funcionários: ${dados.resumo.totalFuncionarios}`
        row++
        sheet.getCell(`A${row}`).value = `Total Crédito: +${dados.resumo.totalCredito}h`
        sheet.getCell(`A${row}`).font = { color: { argb: 'FF008000' } }
        sheet.getCell(`D${row}`).value = `Total Débito: -${dados.resumo.totalDebito}h`
        sheet.getCell(`D${row}`).font = { color: { argb: 'FFFF0000' } }
        row++
        sheet.getCell(`A${row}`).value = `Saldo Geral: ${dados.resumo.saldoGeral >= 0 ? '+' : ''}${dados.resumo.saldoGeral}h`
        sheet.getCell(`A${row}`).font = {
          bold: true,
          color: { argb: dados.resumo.saldoGeral >= 0 ? 'FF008000' : 'FFFF0000' },
        }

        const buffer = await workbook.xlsx.writeBuffer()
        const nomeArquivo = `BancoHoras_${mes}_${ano}.xlsx`

        response.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        return response.send(Buffer.from(buffer))
      }

      return response.json(dados)
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao gerar Banco de Horas:', error)
      return response.internalServerError({
        error: 'Erro ao gerar relatório de banco de horas',
        details: error.message,
      })
    }
  }

  /**
   * Exporta lista de funcionários em Excel
   */
  async exportarFuncionarios({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { lotacao_id, ativo } = request.only(['lotacao_id', 'ativo'])

    try {
      const funcionarios = await RelatorioService.gerarFuncionariosExcel(
        tenant.municipioId,
        lotacao_id ? Number(lotacao_id) : undefined,
        ativo !== undefined ? ativo === 'true' : undefined
      )

      // Registra auditoria
      await AuditService.logFromContext({ request, tenant } as HttpContext, {
        acao: 'EXPORT',
        descricao: 'Exportação de Lista de Funcionários',
      })

      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Funcionários')

      sheet.columns = [
        { header: 'Matrícula', key: 'matricula', width: 12 },
        { header: 'Nome', key: 'nome', width: 40 },
        { header: 'CPF', key: 'cpf', width: 15 },
        { header: 'PIS', key: 'pis', width: 15 },
        { header: 'Cargo', key: 'cargo', width: 30 },
        { header: 'Lotação', key: 'lotacao', width: 30 },
        { header: 'Secretaria', key: 'secretaria', width: 30 },
        { header: 'Tipo Vínculo', key: 'tipoVinculo', width: 20 },
        { header: 'Jornada', key: 'jornada', width: 20 },
        { header: 'Admissão', key: 'dataAdmissao', width: 12 },
        { header: 'Ativo', key: 'ativo', width: 8 },
      ]

      const headerRow = sheet.getRow(1)
      headerRow.font = { bold: true }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

      funcionarios.forEach((f) => sheet.addRow(f))

      const buffer = await workbook.xlsx.writeBuffer()
      const nomeArquivo = `Funcionarios_${DateTime.now().toFormat('yyyyMMdd_HHmm')}.xlsx`

      response.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
      return response.send(Buffer.from(buffer))
    } catch (error: any) {
      console.error('[RelatoriosController] Erro ao exportar funcionários:', error)
      return response.internalServerError({
        error: 'Erro ao exportar lista de funcionários',
        details: error.message,
      })
    }
  }
}
