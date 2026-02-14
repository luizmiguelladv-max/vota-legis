import DatabaseManagerService from '#services/database_manager_service'
import { DateTime } from 'luxon'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

/**
 * Interface para dados do funcionário no espelho
 */
interface DadosFuncionario {
  id: number
  matricula: string
  cpf: string
  pis: string
  nome: string
  cargo: string
  lotacao: string
  secretaria: string
  jornada: string
  carga_horaria_diaria: number
  horario_entrada: string | null
  horario_saida: string | null
  tolerancia_entrada: number
  tolerancia_saida: number
}

/**
 * Interface para registro de ponto diário
 */
interface RegistroDia {
  data: string
  diaSemana: string
  marcacoes: string[]
  horasTrabalhadas: number
  horasExtras: number
  horasFaltantes: number
  atraso: number
  falta: boolean
  feriado: boolean
  ocorrencia?: string
  observacao?: string
}

/**
 * Interface para resumo do espelho
 */
interface ResumoEspelho {
  diasUteis: number
  diasTrabalhados: number
  horasPrevistas: number
  horasTrabalhadas: number
  horasExtras: number
  horasFaltantes: number
  atrasos: number
  faltas: number
  atestados: number
  ferias: number
  licencas: number
}

/**
 * Serviço de Espelho de Ponto
 * Gera relatórios em PDF e Excel
 */
export default class EspelhoPontoService {
  /**
   * Busca dados completos do espelho de ponto
   */
  static async buscarDadosEspelho(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number
  ): Promise<{
    funcionario: DadosFuncionario
    registros: RegistroDia[]
    resumo: ResumoEspelho
    empregador: string
  }> {
    // Busca dados do funcionário
    const funcionario = await this.buscarFuncionario(municipioId, funcionarioId)

    // Calcula período
    const dataInicio = DateTime.local(ano, mes, 1).startOf('month')
    const dataFim = dataInicio.endOf('month')

    // Busca registros de ponto
    const registros = await this.buscarRegistrosMes(
      municipioId,
      funcionarioId,
      dataInicio.toJSDate(),
      dataFim.toJSDate(),
      funcionario
    )

    // Calcula resumo
    const resumo = this.calcularResumo(registros, funcionario.carga_horaria_diaria)

    // Busca nome do empregador
    const empregador = await this.buscarNomeEmpregador(municipioId)

    return { funcionario, registros, resumo, empregador }
  }

  /**
   * Gera espelho de ponto em PDF
   */
  static async gerarPDF(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number
  ): Promise<Buffer> {
    const { funcionario, registros, resumo, empregador } = await this.buscarDadosEspelho(
      municipioId,
      funcionarioId,
      mes,
      ano
    )

    const mesNome = DateTime.local(ano, mes, 1).setLocale('pt-BR').toFormat('MMMM/yyyy')

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const doc = new PDFDocument({ size: 'A4', margin: 40 })

      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Cabeçalho
      doc.fontSize(14).font('Helvetica-Bold').text(empregador, { align: 'center' })
      doc.fontSize(12).font('Helvetica').text('ESPELHO DE PONTO', { align: 'center' })
      doc.fontSize(10).text(`Competência: ${mesNome.toUpperCase()}`, { align: 'center' })
      doc.moveDown()

      // Dados do funcionário
      doc.fontSize(9).font('Helvetica-Bold')
      const y1 = doc.y
      doc.text(`Matrícula: ${funcionario.matricula}`, 40, y1)
      doc.text(`CPF: ${this.formatarCPF(funcionario.cpf)}`, 200, y1)
      doc.text(`PIS: ${funcionario.pis}`, 380, y1)

      doc.moveDown(0.3)
      const y2 = doc.y
      doc.text(`Nome: ${funcionario.nome}`, 40, y2)

      doc.moveDown(0.3)
      const y3 = doc.y
      doc.text(`Cargo: ${funcionario.cargo}`, 40, y3)
      doc.text(`Lotação: ${funcionario.lotacao}`, 280, y3)

      doc.moveDown(0.3)
      const y4 = doc.y
      doc.text(`Jornada: ${funcionario.jornada}`, 40, y4)
      doc.text(`Carga Horária: ${this.minutosParaHoras(funcionario.carga_horaria_diaria)}/dia`, 280, y4)

      doc.moveDown()

      // Linha separadora
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
      doc.moveDown(0.5)

      // Cabeçalho da tabela
      const colWidths = [55, 45, 55, 55, 55, 55, 55, 55, 85]
      const headers = ['Data', 'Dia', 'Ent. 1', 'Saí. 1', 'Ent. 2', 'Saí. 2', 'Trab.', 'Extra', 'Obs']

      doc.font('Helvetica-Bold').fontSize(8)
      let x = 40
      headers.forEach((header, i) => {
        doc.text(header, x, doc.y, { width: colWidths[i], align: 'center' })
        x += colWidths[i]
      })
      doc.moveDown()

      // Linha abaixo do cabeçalho
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
      doc.moveDown(0.3)

      // Registros
      doc.font('Helvetica').fontSize(7)
      for (const reg of registros) {
        const rowY = doc.y

        // Verifica se precisa de nova página
        if (rowY > 750) {
          doc.addPage()
        }

        x = 40
        const dataFormatada = DateTime.fromISO(reg.data).toFormat('dd/MM')

        // Cor de fundo para fins de semana/feriados
        if (reg.diaSemana === 'Sáb' || reg.diaSemana === 'Dom' || reg.feriado) {
          doc.rect(40, doc.y - 2, 515, 12).fill('#f0f0f0')
          doc.fillColor('black')
        }

        // Cor vermelha para faltas
        if (reg.falta) {
          doc.fillColor('red')
        }

        doc.text(dataFormatada, x, doc.y, { width: colWidths[0], align: 'center' })
        x += colWidths[0]
        doc.text(reg.diaSemana, x, doc.y - 10, { width: colWidths[1], align: 'center' })
        x += colWidths[1]

        // Marcações
        for (let i = 0; i < 4; i++) {
          const marcacao = reg.marcacoes[i] || '-'
          doc.text(marcacao, x, doc.y - 10, { width: colWidths[2 + i], align: 'center' })
          x += colWidths[2 + i]
        }

        // Horas trabalhadas
        doc.text(this.minutosParaHoras(reg.horasTrabalhadas), x, doc.y - 10, {
          width: colWidths[6],
          align: 'center',
        })
        x += colWidths[6]

        // Horas extras
        doc.text(reg.horasExtras > 0 ? this.minutosParaHoras(reg.horasExtras) : '-', x, doc.y - 10, {
          width: colWidths[7],
          align: 'center',
        })
        x += colWidths[7]

        // Observação
        const obs = reg.feriado
          ? 'Feriado'
          : reg.ocorrencia
            ? reg.ocorrencia
            : reg.falta
              ? 'Falta'
              : ''
        doc.text(obs, x, doc.y - 10, { width: colWidths[8], align: 'left' })

        doc.fillColor('black')
        doc.moveDown(0.5)
      }

      // Linha separadora
      doc.moveDown()
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
      doc.moveDown()

      // Resumo
      doc.font('Helvetica-Bold').fontSize(10).text('RESUMO', 40, doc.y)
      doc.moveDown(0.5)

      doc.font('Helvetica').fontSize(9)
      const col1 = 40
      const col2 = 200
      const col3 = 360

      const y5 = doc.y
      doc.text(`Dias Úteis: ${resumo.diasUteis}`, col1, y5)
      doc.text(`Dias Trabalhados: ${resumo.diasTrabalhados}`, col2, y5)
      doc.text(`Faltas: ${resumo.faltas}`, col3, y5)

      doc.moveDown(0.3)
      const y6 = doc.y
      doc.text(`Horas Previstas: ${this.minutosParaHoras(resumo.horasPrevistas)}`, col1, y6)
      doc.text(`Horas Trabalhadas: ${this.minutosParaHoras(resumo.horasTrabalhadas)}`, col2, y6)
      doc.text(`Atrasos: ${resumo.atrasos} min`, col3, y6)

      doc.moveDown(0.3)
      const y7 = doc.y
      doc.text(`Horas Extras: ${this.minutosParaHoras(resumo.horasExtras)}`, col1, y7)
      doc.text(`Horas Faltantes: ${this.minutosParaHoras(resumo.horasFaltantes)}`, col2, y7)

      // Assinaturas
      doc.moveDown(3)
      const assinaturaY = doc.y

      doc.moveTo(60, assinaturaY).lineTo(250, assinaturaY).stroke()
      doc.text('Funcionário', 60, assinaturaY + 5, { width: 190, align: 'center' })

      doc.moveTo(310, assinaturaY).lineTo(500, assinaturaY).stroke()
      doc.text('Responsável RH', 310, assinaturaY + 5, { width: 190, align: 'center' })

      // Rodapé
      doc.fontSize(7)
        .text(
          `Gerado em: ${DateTime.now().toFormat('dd/MM/yyyy HH:mm')}`,
          40,
          780,
          { align: 'center', width: 515 }
        )

      doc.end()
    })
  }

  /**
   * Gera espelho de ponto em Excel
   */
  static async gerarExcel(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number
  ): Promise<Buffer> {
    const { funcionario, registros, resumo, empregador } = await this.buscarDadosEspelho(
      municipioId,
      funcionarioId,
      mes,
      ano
    )

    const mesNome = DateTime.local(ano, mes, 1).setLocale('pt-BR').toFormat('MMMM/yyyy')

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Sistema de Ponto Eletrônico'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('Espelho de Ponto')

    // Configurações de colunas
    sheet.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Dia', key: 'dia', width: 8 },
      { header: 'Entrada 1', key: 'entrada1', width: 12 },
      { header: 'Saída 1', key: 'saida1', width: 12 },
      { header: 'Entrada 2', key: 'entrada2', width: 12 },
      { header: 'Saída 2', key: 'saida2', width: 12 },
      { header: 'Trabalhadas', key: 'trabalhadas', width: 12 },
      { header: 'Extras', key: 'extras', width: 12 },
      { header: 'Faltantes', key: 'faltantes', width: 12 },
      { header: 'Observação', key: 'observacao', width: 20 },
    ]

    // Cabeçalho do relatório
    sheet.mergeCells('A1:J1')
    sheet.getCell('A1').value = empregador
    sheet.getCell('A1').font = { bold: true, size: 14 }
    sheet.getCell('A1').alignment = { horizontal: 'center' }

    sheet.mergeCells('A2:J2')
    sheet.getCell('A2').value = `ESPELHO DE PONTO - ${mesNome.toUpperCase()}`
    sheet.getCell('A2').font = { bold: true, size: 12 }
    sheet.getCell('A2').alignment = { horizontal: 'center' }

    // Dados do funcionário
    sheet.getCell('A4').value = 'Matrícula:'
    sheet.getCell('B4').value = funcionario.matricula
    sheet.getCell('C4').value = 'CPF:'
    sheet.getCell('D4').value = this.formatarCPF(funcionario.cpf)

    sheet.getCell('A5').value = 'Nome:'
    sheet.getCell('B5').value = funcionario.nome
    sheet.mergeCells('B5:D5')

    sheet.getCell('A6').value = 'Cargo:'
    sheet.getCell('B6').value = funcionario.cargo
    sheet.getCell('C6').value = 'Lotação:'
    sheet.getCell('D6').value = funcionario.lotacao

    sheet.getCell('A7').value = 'Jornada:'
    sheet.getCell('B7').value = funcionario.jornada
    sheet.getCell('C7').value = 'Carga Horária:'
    sheet.getCell('D7').value = `${this.minutosParaHoras(funcionario.carga_horaria_diaria)}/dia`

    // Estilo para labels
    ;['A4', 'C4', 'A5', 'A6', 'C6', 'A7', 'C7'].forEach((cell) => {
      sheet.getCell(cell).font = { bold: true }
    })

    // Cabeçalho da tabela (linha 9)
    const headerRow = sheet.getRow(9)
    headerRow.values = [
      'Data',
      'Dia',
      'Entrada 1',
      'Saída 1',
      'Entrada 2',
      'Saída 2',
      'Trabalhadas',
      'Extras',
      'Faltantes',
      'Observação',
    ]
    headerRow.font = { bold: true }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    }
    headerRow.alignment = { horizontal: 'center' }

    // Dados
    let rowIndex = 10
    for (const reg of registros) {
      const row = sheet.getRow(rowIndex)

      const obs = reg.feriado
        ? 'Feriado'
        : reg.ocorrencia
          ? reg.ocorrencia
          : reg.falta
            ? 'Falta'
            : ''

      row.values = [
        DateTime.fromISO(reg.data).toFormat('dd/MM/yyyy'),
        reg.diaSemana,
        reg.marcacoes[0] || '-',
        reg.marcacoes[1] || '-',
        reg.marcacoes[2] || '-',
        reg.marcacoes[3] || '-',
        this.minutosParaHoras(reg.horasTrabalhadas),
        reg.horasExtras > 0 ? this.minutosParaHoras(reg.horasExtras) : '-',
        reg.horasFaltantes > 0 ? this.minutosParaHoras(reg.horasFaltantes) : '-',
        obs,
      ]

      // Estilo para fins de semana/feriados
      if (reg.diaSemana === 'Sáb' || reg.diaSemana === 'Dom' || reg.feriado) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF0F0F0' },
        }
      }

      // Estilo para faltas
      if (reg.falta) {
        row.font = { color: { argb: 'FFFF0000' } }
      }

      row.alignment = { horizontal: 'center' }
      rowIndex++
    }

    // Linha em branco
    rowIndex++

    // Resumo
    sheet.mergeCells(`A${rowIndex}:J${rowIndex}`)
    sheet.getCell(`A${rowIndex}`).value = 'RESUMO'
    sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 11 }
    rowIndex++

    const resumoData = [
      ['Dias Úteis', resumo.diasUteis, 'Dias Trabalhados', resumo.diasTrabalhados],
      [
        'Horas Previstas',
        this.minutosParaHoras(resumo.horasPrevistas),
        'Horas Trabalhadas',
        this.minutosParaHoras(resumo.horasTrabalhadas),
      ],
      [
        'Horas Extras',
        this.minutosParaHoras(resumo.horasExtras),
        'Horas Faltantes',
        this.minutosParaHoras(resumo.horasFaltantes),
      ],
      ['Faltas', resumo.faltas, 'Atrasos (min)', resumo.atrasos],
    ]

    for (const item of resumoData) {
      const row = sheet.getRow(rowIndex)
      row.getCell(1).value = item[0]
      row.getCell(1).font = { bold: true }
      row.getCell(2).value = item[1]
      row.getCell(3).value = item[2]
      row.getCell(3).font = { bold: true }
      row.getCell(4).value = item[3]
      rowIndex++
    }

    // Bordas na tabela
    for (let i = 9; i < rowIndex - 5; i++) {
      const row = sheet.getRow(i)
      for (let j = 1; j <= 10; j++) {
        row.getCell(j).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
  }

  /**
   * Busca dados do funcionário
   */
  private static async buscarFuncionario(
    municipioId: number,
    funcionarioId: number
  ): Promise<DadosFuncionario> {
    const query = `
      SELECT
        f.id, f.matricula, f.cpf, f.pis, f.nome,
        c.nome as cargo,
        l.nome as lotacao,
        s.nome as secretaria,
        j.nome as jornada,
        COALESCE(j.carga_horaria_diaria, 480) as carga_horaria_diaria,
        j.horario_entrada,
        j.horario_saida,
        COALESCE(j.tolerancia_entrada, 10) as tolerancia_entrada,
        COALESCE(j.tolerancia_saida, 10) as tolerancia_saida
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN secretarias s ON s.id = l.secretaria_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE f.id = $1
    `

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query, [funcionarioId])

    if (result.rows.length === 0) {
      throw new Error('Funcionário não encontrado')
    }

    const row = result.rows[0]
    return {
      id: row.id,
      matricula: row.matricula || '',
      cpf: row.cpf || '',
      pis: row.pis || '',
      nome: row.nome || '',
      cargo: row.cargo || '-',
      lotacao: row.lotacao || '-',
      secretaria: row.secretaria || '-',
      jornada: row.jornada || '-',
      carga_horaria_diaria: row.carga_horaria_diaria || 480,
      horario_entrada: row.horario_entrada || null,
      horario_saida: row.horario_saida || null,
      tolerancia_entrada: row.tolerancia_entrada || 10,
      tolerancia_saida: row.tolerancia_saida || 10,
    }
  }

  /**
   * Busca registros de ponto do mês
   */
  private static async buscarRegistrosMes(
    municipioId: number,
    funcionarioId: number,
    dataInicio: Date,
    dataFim: Date,
    funcionario: DadosFuncionario
  ): Promise<RegistroDia[]> {
    const cargaHorariaDiaria = funcionario.carga_horaria_diaria
    // Busca feriados do período
    const feriadosQuery = `
      SELECT data FROM feriados
      WHERE data >= $1 AND data <= $2 AND ativo = true
    `
    const feriadosResult = await DatabaseManagerService.queryMunicipio(municipioId, feriadosQuery, [
      dataInicio,
      dataFim,
    ])
    const feriados = new Set(
      feriadosResult.rows.map((r: any) => DateTime.fromJSDate(r.data).toISODate())
    )

    // Busca ocorrências do período
    const ocorrenciasQuery = `
      SELECT o.data_inicio, o.data_fim, t.nome as tipo
      FROM ocorrencias o
      JOIN tipos_ocorrencia t ON t.id = o.tipo_ocorrencia_id
      WHERE o.funcionario_id = $1
        AND o.data_inicio <= $2
        AND o.data_fim >= $3
    `
    const ocorrenciasResult = await DatabaseManagerService.queryMunicipio(
      municipioId,
      ocorrenciasQuery,
      [funcionarioId, dataFim, dataInicio]
    )

    // Mapa de ocorrências por data
    const ocorrenciasPorData: Record<string, string> = {}
    for (const oc of ocorrenciasResult.rows) {
      let dataAtual = DateTime.fromJSDate(oc.data_inicio)
      const dataFimOc = DateTime.fromJSDate(oc.data_fim)
      while (dataAtual <= dataFimOc) {
        ocorrenciasPorData[dataAtual.toISODate()!] = oc.tipo
        dataAtual = dataAtual.plus({ days: 1 })
      }
    }

    // Busca registros de ponto
    const pontosQuery = `
      SELECT DATE(data_hora) as data, data_hora
      FROM registros_ponto
      WHERE funcionario_id = $1
        AND data_hora >= $2
        AND data_hora <= $3
      ORDER BY data_hora ASC
    `
    const pontosResult = await DatabaseManagerService.queryMunicipio(municipioId, pontosQuery, [
      funcionarioId,
      dataInicio,
      dataFim,
    ])

    // Agrupa marcações por dia
    const marcacoesPorDia: Record<string, Date[]> = {}
    for (const row of pontosResult.rows) {
      const dataKey = DateTime.fromJSDate(row.data).toISODate()!
      if (!marcacoesPorDia[dataKey]) {
        marcacoesPorDia[dataKey] = []
      }
      marcacoesPorDia[dataKey].push(row.data_hora)
    }

    // Gera lista de todos os dias do mês
    const registros: RegistroDia[] = []
    let dataAtual = DateTime.fromJSDate(dataInicio)
    const dataFimDt = DateTime.fromJSDate(dataFim)

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    while (dataAtual <= dataFimDt) {
      const dataKey = dataAtual.toISODate()!
      const diaSemana = diasSemana[dataAtual.weekday % 7]
      const ehFimDeSemana = dataAtual.weekday === 6 || dataAtual.weekday === 7
      const ehFeriado = feriados.has(dataKey)
      const ocorrencia = ocorrenciasPorData[dataKey]

      const marcacoes = marcacoesPorDia[dataKey] || []
      const marcacoesFormatadas = marcacoes.map((m) => DateTime.fromJSDate(m).toFormat('HH:mm'))

      // Calcula horas trabalhadas
      let horasTrabalhadas = 0
      if (marcacoes.length >= 2) {
        for (let i = 0; i < marcacoes.length - 1; i += 2) {
          const entrada = DateTime.fromJSDate(marcacoes[i])
          const saida = marcacoes[i + 1] ? DateTime.fromJSDate(marcacoes[i + 1]) : entrada
          horasTrabalhadas += saida.diff(entrada, 'minutes').minutes
        }
      }

      // Calcula atraso baseado na jornada
      let atraso = 0
      if (marcacoes.length > 0 && funcionario.horario_entrada && !ehFimDeSemana && !ehFeriado && !ocorrencia) {
        const primeiraEntrada = DateTime.fromJSDate(marcacoes[0])

        // Monta o horário esperado de entrada para este dia
        const [horaEntrada, minutoEntrada] = funcionario.horario_entrada.split(':').map(Number)
        const horarioEsperado = dataAtual.set({ hour: horaEntrada, minute: minutoEntrada, second: 0 })

        // Adiciona tolerância
        const horarioComTolerancia = horarioEsperado.plus({ minutes: funcionario.tolerancia_entrada })

        // Se chegou depois do horário + tolerância, é atraso
        if (primeiraEntrada > horarioComTolerancia) {
          atraso = Math.round(primeiraEntrada.diff(horarioEsperado, 'minutes').minutes)
        }
      }

      // Calcula extras e faltantes
      let horasExtras = 0
      let horasFaltantes = 0
      let falta = false

      if (!ehFimDeSemana && !ehFeriado && !ocorrencia) {
        if (horasTrabalhadas > cargaHorariaDiaria) {
          horasExtras = horasTrabalhadas - cargaHorariaDiaria
        } else if (horasTrabalhadas < cargaHorariaDiaria && marcacoes.length > 0) {
          horasFaltantes = cargaHorariaDiaria - horasTrabalhadas
        } else if (marcacoes.length === 0) {
          falta = true
          horasFaltantes = cargaHorariaDiaria
        }
      }

      registros.push({
        data: dataKey,
        diaSemana,
        marcacoes: marcacoesFormatadas,
        horasTrabalhadas: Math.round(horasTrabalhadas),
        horasExtras: Math.round(horasExtras),
        horasFaltantes: Math.round(horasFaltantes),
        atraso,
        falta,
        feriado: ehFeriado,
        ocorrencia,
      })

      dataAtual = dataAtual.plus({ days: 1 })
    }

    return registros
  }

  /**
   * Calcula resumo do espelho
   */
  private static calcularResumo(registros: RegistroDia[], cargaHorariaDiaria: number): ResumoEspelho {
    let diasUteis = 0
    let diasTrabalhados = 0
    let horasTrabalhadas = 0
    let horasExtras = 0
    let horasFaltantes = 0
    let atrasos = 0
    let faltas = 0
    let atestados = 0
    let ferias = 0
    let licencas = 0

    for (const reg of registros) {
      const ehFimDeSemana = reg.diaSemana === 'Sáb' || reg.diaSemana === 'Dom'

      if (!ehFimDeSemana && !reg.feriado) {
        diasUteis++

        if (reg.ocorrencia) {
          if (reg.ocorrencia.toLowerCase().includes('atestado')) atestados++
          else if (reg.ocorrencia.toLowerCase().includes('férias')) ferias++
          else if (reg.ocorrencia.toLowerCase().includes('licença')) licencas++
        } else if (reg.falta) {
          faltas++
        } else if (reg.marcacoes.length > 0) {
          diasTrabalhados++
        }
      }

      horasTrabalhadas += reg.horasTrabalhadas
      horasExtras += reg.horasExtras
      horasFaltantes += reg.horasFaltantes
      atrasos += reg.atraso
    }

    return {
      diasUteis,
      diasTrabalhados,
      horasPrevistas: diasUteis * cargaHorariaDiaria,
      horasTrabalhadas,
      horasExtras,
      horasFaltantes,
      atrasos,
      faltas,
      atestados,
      ferias,
      licencas,
    }
  }

  /**
   * Busca nome do empregador
   */
  private static async buscarNomeEmpregador(municipioId: number): Promise<string> {
    const query = `SELECT nome FROM unidades_gestoras WHERE ativo = true ORDER BY id LIMIT 1`
    const result = await DatabaseManagerService.queryMunicipio(municipioId, query)

    if (result.rows.length > 0) {
      return result.rows[0].nome
    }

    const Municipio = (await import('#models/municipio')).default
    const municipio = await Municipio.find(municipioId)
    return municipio ? `PREFEITURA MUNICIPAL DE ${municipio.nome.toUpperCase()}` : 'EMPREGADOR'
  }

  /**
   * Formata CPF
   */
  private static formatarCPF(cpf: string): string {
    const numeros = cpf.replace(/\D/g, '')
    return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }

  /**
   * Converte minutos para formato HH:mm
   */
  private static minutosParaHoras(minutos: number): string {
    const horas = Math.floor(minutos / 60)
    const mins = minutos % 60
    return `${horas.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  }
}
