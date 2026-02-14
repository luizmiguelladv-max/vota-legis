/**
 * Serviço de geração de eventos eSocial
 * Implementa S-2230 - Afastamento Temporário
 */

interface DadosFuncionario {
  cpf: string
  nome: string
  matricula: string
  nis_pis: string
  data_admissao: string
}

interface DadosEmpregador {
  cnpj: string
  razao_social: string
  inscricao_tipo: number // 1-CNPJ, 2-CPF
}

interface DadosAfastamento {
  id: number
  funcionario_id: number
  tipo: string
  data_inicio: string
  data_fim: string | null
  dias_corridos: number
  cid: string | null
  motivo: string | null
  acidente_trabalho: boolean
  data_inicio_inss: string | null
}

// Tabela 18 do eSocial - Motivos de Afastamento
const MOTIVOS_ESOCIAL: Record<string, { codigo: string; descricao: string }> = {
  'LICENCA_MEDICA': { codigo: '01', descricao: 'Acidente/Doença não relacionada ao trabalho' },
  'ATESTADO_MEDICO': { codigo: '01', descricao: 'Acidente/Doença não relacionada ao trabalho' },
  'ACIDENTE_TRABALHO': { codigo: '03', descricao: 'Acidente/Doença do Trabalho' },
  'LICENCA_MATERNIDADE': { codigo: '17', descricao: 'Licença Maternidade' },
  'LICENCA_PATERNIDADE': { codigo: '19', descricao: 'Licença Paternidade' },
  'FERIAS': { codigo: '15', descricao: 'Férias' },
  'AFASTAMENTO_INSS': { codigo: '01', descricao: 'Acidente/Doença não relacionada ao trabalho' },
  'LICENCA_CASAMENTO': { codigo: '16', descricao: 'Licença remunerada - Lei, Convenção, Acordo' },
  'LICENCA_OBITO': { codigo: '16', descricao: 'Licença remunerada - Lei, Convenção, Acordo' },
}

// Tipos de benefício INSS
const TIPOS_BENEFICIO = {
  'B31': 'Auxílio-doença previdenciário',
  'B91': 'Auxílio-doença acidentário',
  'B94': 'Auxílio-acidente',
  'B32': 'Aposentadoria por invalidez previdenciária',
  'B92': 'Aposentadoria por invalidez acidentária',
}

export class EsocialService {
  
  /**
   * Calcula se afastamento precisa ir para INSS (> 15 dias)
   */
  static calcularDiasINSS(afastamento: DadosAfastamento): {
    diasEmpresa: number
    diasINSS: number
    dataInicioINSS: string | null
    precisaINSS: boolean
  } {
    const diasTotais = afastamento.dias_corridos
    
    // Acidente de trabalho: desde o 1º dia é INSS
    if (afastamento.acidente_trabalho) {
      const dataInicio = new Date(afastamento.data_inicio)
      return {
        diasEmpresa: 0,
        diasINSS: diasTotais,
        dataInicioINSS: afastamento.data_inicio,
        precisaINSS: true
      }
    }
    
    // Licença médica comum: 15 dias empresa, resto INSS
    if (diasTotais > 15) {
      const dataInicio = new Date(afastamento.data_inicio)
      const dataInicioINSS = new Date(dataInicio)
      dataInicioINSS.setDate(dataInicioINSS.getDate() + 15)
      
      return {
        diasEmpresa: 15,
        diasINSS: diasTotais - 15,
        dataInicioINSS: dataInicioINSS.toISOString().split('T')[0],
        precisaINSS: true
      }
    }
    
    return {
      diasEmpresa: diasTotais,
      diasINSS: 0,
      dataInicioINSS: null,
      precisaINSS: false
    }
  }

  /**
   * Gera ID único para o evento (formato eSocial)
   */
  static gerarIdEvento(cnpj: string, sequencial: number): string {
    const ano = new Date().getFullYear()
    const cnpjLimpo = cnpj.replace(/\D/g, '')
    const seq = String(sequencial).padStart(5, '0')
    return `ID${cnpjLimpo}${ano}${seq}`
  }

  /**
   * Gera XML do evento S-2230 - Afastamento Temporário
   */
  static gerarS2230(
    empregador: DadosEmpregador,
    funcionario: DadosFuncionario,
    afastamento: DadosAfastamento,
    sequencial: number = 1
  ): string {
    const idEvento = this.gerarIdEvento(empregador.cnpj, sequencial)
    const dataGeracao = new Date().toISOString()
    const cnpjLimpo = empregador.cnpj.replace(/\D/g, '')
    const cpfLimpo = funcionario.cpf.replace(/\D/g, '')
    const pisLimpo = funcionario.nis_pis?.replace(/\D/g, '') || ''
    
    // Determinar motivo eSocial
    let tipoAfastamento = afastamento.tipo
    if (afastamento.acidente_trabalho) {
      tipoAfastamento = 'ACIDENTE_TRABALHO'
    }
    const motivoESocial = MOTIVOS_ESOCIAL[tipoAfastamento] || MOTIVOS_ESOCIAL['LICENCA_MEDICA']
    
    // Calcular dias INSS
    const calculoINSS = this.calcularDiasINSS(afastamento)
    
    // Data de início do afastamento para eSocial
    // Se for > 15 dias, o S-2230 é enviado com data do 16º dia
    const dataIniAfastamento = calculoINSS.dataInicioINSS || afastamento.data_inicio

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAfastTemp/v_S_01_02_00">
  <evtAfastTemp Id="${idEvento}">
    <ideEvento>
      <indRetif>1</indRetif>
      <tpAmb>2</tpAmb>
      <procEmi>1</procEmi>
      <verProc>GETPONTO_1.0</verProc>
    </ideEvento>
    <ideEmpregador>
      <tpInsc>${empregador.inscricao_tipo}</tpInsc>
      <nrInsc>${cnpjLimpo.substring(0, 8)}</nrInsc>
    </ideEmpregador>
    <ideVinculo>
      <cpfTrab>${cpfLimpo}</cpfTrab>
      <matricula>${funcionario.matricula}</matricula>
    </ideVinculo>
    <infoAfastamento>
      <iniAfastamento>
        <dtIniAfast>${dataIniAfastamento}</dtIniAfast>
        <codMotAfast>${motivoESocial.codigo}</codMotAfast>
        ${afastamento.cid ? `<infoAtestado>
          <codCID>${afastamento.cid}</codCID>
        </infoAtestado>` : ''}
      </iniAfastamento>
      ${afastamento.data_fim ? `<fimAfastamento>
        <dtFimAfast>${afastamento.data_fim}</dtFimAfast>
      </fimAfastamento>` : ''}
    </infoAfastamento>
  </evtAfastTemp>
</eSocial>`

    return xml
  }

  /**
   * Gera relatório de afastamentos para conferência
   */
  static gerarRelatorioAfastamento(
    funcionario: DadosFuncionario,
    afastamento: DadosAfastamento
  ): {
    funcionario: string
    cpf: string
    periodo: string
    diasTotais: number
    diasEmpresa: number
    diasINSS: number
    dataInicioINSS: string | null
    precisaINSS: boolean
    tipoBeneficioSugerido: string
    motivoESocial: string
  } {
    const calculo = this.calcularDiasINSS(afastamento)
    
    let tipoAfastamento = afastamento.tipo
    if (afastamento.acidente_trabalho) {
      tipoAfastamento = 'ACIDENTE_TRABALHO'
    }
    const motivoESocial = MOTIVOS_ESOCIAL[tipoAfastamento] || MOTIVOS_ESOCIAL['LICENCA_MEDICA']
    
    // Sugerir tipo de benefício
    let tipoBeneficio = 'B31' // Auxílio-doença previdenciário (padrão)
    if (afastamento.acidente_trabalho) {
      tipoBeneficio = 'B91' // Auxílio-doença acidentário
    }

    return {
      funcionario: funcionario.nome,
      cpf: funcionario.cpf,
      periodo: `${afastamento.data_inicio} a ${afastamento.data_fim || 'em aberto'}`,
      diasTotais: afastamento.dias_corridos,
      diasEmpresa: calculo.diasEmpresa,
      diasINSS: calculo.diasINSS,
      dataInicioINSS: calculo.dataInicioINSS,
      precisaINSS: calculo.precisaINSS,
      tipoBeneficioSugerido: `${tipoBeneficio} - ${TIPOS_BENEFICIO[tipoBeneficio as keyof typeof TIPOS_BENEFICIO]}`,
      motivoESocial: `${motivoESocial.codigo} - ${motivoESocial.descricao}`
    }
  }
}

export default EsocialService
