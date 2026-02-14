/**
 * ===========================================================================
 * SERVIÇO DE VALIDAÇÃO E CONSULTA DE CNPJ
 * ===========================================================================
 *
 * Este serviço é responsável por:
 * 1. Validar CNPJ (dígitos verificadores)
 * 2. Consultar dados da empresa na Receita Federal via BrasilAPI
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-20
 */

/**
 * Interface para os dados retornados pela API de consulta CNPJ
 */
export interface DadosEmpresa {
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  situacao_cadastral: string
  descricao_situacao_cadastral: string
  data_situacao_cadastral: string
  data_inicio_atividade: string
  tipo: string // MATRIZ ou FILIAL
  porte: string
  natureza_juridica: string
  cnae_fiscal: number
  cnae_fiscal_descricao: string
  logradouro: string
  numero: string
  complemento: string | null
  bairro: string
  cep: string
  uf: string
  municipio: string
  email: string | null
  telefone: string | null
  // Campos adicionais do BrasilAPI
  capital_social?: number
  qsa?: Array<{
    nome: string
    qual: string
  }>
}

/**
 * Interface para o resultado da validação
 */
export interface ResultadoValidacaoCNPJ {
  valido: boolean
  formatado: string
  numeros: string
  erro?: string
}

/**
 * Interface para o resultado da consulta
 */
export interface ResultadoConsultaCNPJ {
  sucesso: boolean
  dados?: DadosEmpresa
  erro?: string
}

class CNPJService {
  /**
   * Remove caracteres não numéricos do CNPJ
   */
  limparCNPJ(cnpj: string): string {
    return cnpj.replace(/\D/g, '')
  }

  /**
   * Formata CNPJ com pontuação
   * @example "12345678000199" -> "12.345.678/0001-99"
   */
  formatarCNPJ(cnpj: string): string {
    const numeros = this.limparCNPJ(cnpj)
    if (numeros.length !== 14) return cnpj

    return numeros.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5'
    )
  }

  /**
   * Valida CNPJ usando algoritmo dos dígitos verificadores
   *
   * O CNPJ possui 14 dígitos: NNNNNNNN/SSSS-DD
   * - N: 8 dígitos base
   * - S: 4 dígitos do número da filial (0001 para matriz)
   * - D: 2 dígitos verificadores
   *
   * @param cnpj - CNPJ a ser validado (com ou sem formatação)
   * @returns Resultado da validação com CNPJ formatado e limpo
   */
  validar(cnpj: string): ResultadoValidacaoCNPJ {
    const numeros = this.limparCNPJ(cnpj)

    // Verificar tamanho
    if (numeros.length !== 14) {
      return {
        valido: false,
        formatado: cnpj,
        numeros,
        erro: 'CNPJ deve ter 14 dígitos',
      }
    }

    // Verificar se todos os dígitos são iguais (inválido)
    if (/^(\d)\1+$/.test(numeros)) {
      return {
        valido: false,
        formatado: this.formatarCNPJ(numeros),
        numeros,
        erro: 'CNPJ inválido - todos os dígitos são iguais',
      }
    }

    // Calcular primeiro dígito verificador
    const multiplicadores1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < 12; i++) {
      soma += parseInt(numeros[i]) * multiplicadores1[i]
    }
    let resto = soma % 11
    const digito1 = resto < 2 ? 0 : 11 - resto

    // Verificar primeiro dígito
    if (parseInt(numeros[12]) !== digito1) {
      return {
        valido: false,
        formatado: this.formatarCNPJ(numeros),
        numeros,
        erro: 'CNPJ inválido - primeiro dígito verificador não confere',
      }
    }

    // Calcular segundo dígito verificador
    const multiplicadores2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    soma = 0
    for (let i = 0; i < 13; i++) {
      soma += parseInt(numeros[i]) * multiplicadores2[i]
    }
    resto = soma % 11
    const digito2 = resto < 2 ? 0 : 11 - resto

    // Verificar segundo dígito
    if (parseInt(numeros[13]) !== digito2) {
      return {
        valido: false,
        formatado: this.formatarCNPJ(numeros),
        numeros,
        erro: 'CNPJ inválido - segundo dígito verificador não confere',
      }
    }

    return {
      valido: true,
      formatado: this.formatarCNPJ(numeros),
      numeros,
    }
  }

  /**
   * Consulta dados da empresa na Receita Federal via BrasilAPI
   *
   * A BrasilAPI é gratuita e não requer autenticação.
   * Endpoint: https://brasilapi.com.br/api/cnpj/v1/{cnpj}
   *
   * @param cnpj - CNPJ a ser consultado (com ou sem formatação)
   * @returns Dados da empresa ou erro
   */
  async consultar(cnpj: string): Promise<ResultadoConsultaCNPJ> {
    // Validar antes de consultar
    const validacao = this.validar(cnpj)
    if (!validacao.valido) {
      return {
        sucesso: false,
        erro: validacao.erro,
      }
    }

    try {
      const response = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${validacao.numeros}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'PontoEletronico/1.0',
          },
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          return {
            sucesso: false,
            erro: 'CNPJ não encontrado na Receita Federal',
          }
        }
        if (response.status === 429) {
          return {
            sucesso: false,
            erro: 'Muitas requisições. Tente novamente em alguns segundos',
          }
        }
        return {
          sucesso: false,
          erro: `Erro ao consultar CNPJ: ${response.statusText}`,
        }
      }

      const data = await response.json()

      // Mapear resposta para nossa interface
      const empresa: DadosEmpresa = {
        cnpj: validacao.formatado,
        razao_social: data.razao_social || '',
        nome_fantasia: data.nome_fantasia || null,
        situacao_cadastral: data.descricao_situacao_cadastral || '',
        descricao_situacao_cadastral: data.descricao_situacao_cadastral || '',
        data_situacao_cadastral: data.data_situacao_cadastral || '',
        data_inicio_atividade: data.data_inicio_atividade || '',
        tipo: data.descricao_identificador_matriz_filial || 'MATRIZ',
        porte: data.porte || '',
        natureza_juridica: data.natureza_juridica || '',
        cnae_fiscal: data.cnae_fiscal || 0,
        cnae_fiscal_descricao: data.cnae_fiscal_descricao || '',
        logradouro: data.logradouro || '',
        numero: data.numero || '',
        complemento: data.complemento || null,
        bairro: data.bairro || '',
        cep: data.cep || '',
        uf: data.uf || '',
        municipio: data.municipio || '',
        email: data.email || null,
        telefone: data.ddd_telefone_1
          ? `(${data.ddd_telefone_1}) ${data.ddd_telefone_1}`
          : null,
        capital_social: data.capital_social || 0,
        qsa: data.qsa || [],
      }

      return {
        sucesso: true,
        dados: empresa,
      }
    } catch (error: any) {
      // Erro de rede ou parsing
      return {
        sucesso: false,
        erro: `Erro de conexão: ${error.message}`,
      }
    }
  }

  /**
   * Verifica se o CNPJ está ativo na Receita Federal
   *
   * @param cnpj - CNPJ a ser verificado
   * @returns true se ativo, false caso contrário
   */
  async isAtivo(cnpj: string): Promise<boolean> {
    const resultado = await this.consultar(cnpj)
    if (!resultado.sucesso || !resultado.dados) return false

    const situacoesAtivas = ['ATIVA', 'ATIVO']
    return situacoesAtivas.some((s) =>
      resultado.dados!.situacao_cadastral.toUpperCase().includes(s)
    )
  }
}

// Exporta instância singleton
export const cnpjService = new CNPJService()
export default cnpjService
