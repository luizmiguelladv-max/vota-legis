/**
 * Gemini Service - Integração com Google Gemini API
 * 
 * Usado para:
 * - Geração automática de matérias legislativas
 * - Criação de atas de sessão
 * - Sumarização de documentos
 */

import env from '#start/env'

interface MateriaGerada {
  tipo: string
  numero: string
  ementa: string
  justificativa: string
  texto: string
  autor: string
  partido: string
  municipio: string
  data: string
}

interface PromptContext {
  tipo: string
  descricao: string
  municipio: string
  vereador: string
  partido: string
  data?: string
}

class GeminiService {
  private apiKey: string
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

  constructor() {
    this.apiKey = env.get('GEMINI_API_KEY', '')
  }

  /**
   * Gera uma matéria legislativa com base na descrição do vereador
   */
  async gerarMateria(context: PromptContext): Promise<MateriaGerada> {
    const prompt = this.buildMateriaPrompt(context)
    const response = await this.callGemini(prompt)
    return this.parseMateriaResponse(response, context)
  }

  /**
   * Gera ata automática de uma sessão
   */
  async gerarAta(dadosSessao: {
    municipio: string
    sessao: any
    presencas: any[]
    votacoes: any[]
    falas: any[]
    expedientes: any[]
  }): Promise<string> {
    const prompt = this.buildAtaPrompt(dadosSessao)
    return await this.callGemini(prompt)
  }

  /**
   * Melhora/corrige texto de matéria existente
   */
  async melhorarTexto(texto: string, instrucoes: string): Promise<string> {
    const prompt = `
Você é um redator legislativo especializado. Melhore o seguinte texto de matéria legislativa conforme as instruções:

INSTRUÇÕES: ${instrucoes}

TEXTO ORIGINAL:
${texto}

Retorne apenas o texto melhorado, mantendo a formatação legislativa.
`
    return await this.callGemini(prompt)
  }

  /**
   * Sugere ementa para uma matéria
   */
  async sugerirEmenta(tipo: string, texto: string): Promise<string> {
    const prompt = `
Você é um redator legislativo. Crie uma ementa concisa e técnica para o seguinte ${tipo}:

${texto}

A ementa deve:
- Ser clara e objetiva
- Ter no máximo 2 linhas
- Começar com verbo no infinitivo ou substantivo
- Seguir o padrão legislativo brasileiro

Retorne apenas a ementa, sem explicações.
`
    return await this.callGemini(prompt)
  }

  /**
   * Constrói o prompt para geração de matéria
   */
  private buildMateriaPrompt(context: PromptContext): string {
    const tiposInfo: Record<string, { descricao: string; estrutura: string }> = {
      'requerimento': {
        descricao: 'Documento que solicita providências, informações ou medidas ao Poder Executivo ou à própria Câmara',
        estrutura: 'REQUER ao [destinatário] que [ação solicitada], conforme [justificativa].'
      },
      'indicacao': {
        descricao: 'Sugestão ao Poder Executivo para adoção de providências ou realização de ato administrativo',
        estrutura: 'INDICA ao Poder Executivo Municipal que [sugestão], visando [objetivo].'
      },
      'mocao': {
        descricao: 'Manifestação de aplauso, congratulação, pesar, repúdio ou apoio sobre determinado assunto',
        estrutura: 'Apresenta MOÇÃO DE [tipo] ao/pela [destinatário/motivo].'
      },
      'projeto_lei_ordinaria': {
        descricao: 'Proposição que visa criar, alterar ou revogar lei ordinária municipal',
        estrutura: `Art. 1º [Disposição principal]
Art. 2º [Detalhamentos]
Art. 3º Esta Lei entra em vigor na data de sua publicação.`
      },
      'projeto_lei_complementar': {
        descricao: 'Proposição que regulamenta matéria prevista na Lei Orgânica Municipal',
        estrutura: `Art. 1º [Disposição principal]
Art. 2º [Detalhamentos]
Art. 3º Esta Lei Complementar entra em vigor na data de sua publicação.`
      },
      'projeto_resolucao': {
        descricao: 'Norma interna da Câmara Municipal que regula matéria de sua competência privativa',
        estrutura: `Art. 1º [Disposição principal]
Art. 2º Esta Resolução entra em vigor na data de sua publicação.`
      },
      'projeto_decreto_legislativo': {
        descricao: 'Ato normativo de competência exclusiva do Legislativo que não depende de sanção do Executivo',
        estrutura: `Art. 1º [Disposição principal]
Art. 2º Este Decreto Legislativo entra em vigor na data de sua publicação.`
      }
    }

    const tipoInfo = tiposInfo[context.tipo] || tiposInfo['requerimento']
    const dataFormatada = context.data || new Date().toLocaleDateString('pt-BR')

    return `
Você é um redator legislativo especializado em câmaras municipais brasileiras.

Gere um(a) ${context.tipo.replace(/_/g, ' ').toUpperCase()} completo(a) com base na seguinte solicitação do vereador:

"${context.descricao}"

INFORMAÇÕES:
- Tipo: ${context.tipo.replace(/_/g, ' ')}
- Definição: ${tipoInfo.descricao}
- Câmara Municipal de: ${context.municipio}
- Autor(a): ${context.vereador}
- Partido: ${context.partido}
- Data: ${dataFormatada}

O documento deve seguir RIGOROSAMENTE o padrão legislativo brasileiro com:

1. EMENTA: Resumo claro e conciso do conteúdo (máximo 2 linhas)

2. TEXTO PRINCIPAL: Seguindo a estrutura:
${tipoInfo.estrutura}

3. JUSTIFICATIVA: Fundamentação técnica, social e jurídica para a proposição

REGRAS:
- Use linguagem formal e técnica
- Cite legislação pertinente quando aplicável
- Seja objetivo e claro
- Mantenha formatação profissional
- NÃO invente números de leis ou dados específicos
- Use termos como "legislação vigente" ou "normas aplicáveis" quando necessário

Retorne EXATAMENTE no formato JSON abaixo (sem markdown, apenas JSON puro):
{
  "ementa": "texto da ementa",
  "texto": "texto completo da matéria com artigos/parágrafos",
  "justificativa": "texto da justificativa"
}
`
  }

  /**
   * Constrói o prompt para geração de ata
   */
  private buildAtaPrompt(dados: any): string {
    const { municipio, sessao, presencas, votacoes, falas, expedientes } = dados

    const presencasTexto = presencas
      .filter((p: any) => p.presente)
      .map((p: any) => `${p.nome_parlamentar || p.nome} (${p.partido})`)
      .join(', ')

    const ausentesTexto = presencas
      .filter((p: any) => !p.presente)
      .map((p: any) => `${p.nome_parlamentar || p.nome} (${p.partido})`)
      .join(', ')

    const votacoesTexto = votacoes.map((v: any) => {
      return `- ${v.materia || v.descricao}: ${v.resultado?.toUpperCase()} (${v.votos_sim} SIM x ${v.votos_nao} NÃO x ${v.votos_abstencao} ABSTENÇÃO)`
    }).join('\n')

    return `
Você é um redator legislativo. Gere a ATA da sessão com base nos dados abaixo:

DADOS DA SESSÃO:
- Câmara Municipal de: ${municipio}
- Tipo: Sessão ${sessao.tipo}
- Número: ${sessao.numero}/${sessao.ano}
- Data: ${new Date(sessao.data).toLocaleDateString('pt-BR')}
- Horário início: ${sessao.hora_inicio || 'não informado'}
- Horário término: ${sessao.hora_fim || 'não informado'}

PRESENTES (${presencas.filter((p: any) => p.presente).length}):
${presencasTexto || 'Nenhum'}

AUSENTES (${presencas.filter((p: any) => !p.presente).length}):
${ausentesTexto || 'Nenhum'}

EXPEDIENTES LIDOS:
${expedientes.map((e: any) => `- ${e.tipo}: ${e.titulo}`).join('\n') || 'Nenhum'}

VOTAÇÕES REALIZADAS:
${votacoesTexto || 'Nenhuma votação realizada'}

Gere uma ata formal seguindo o padrão legislativo brasileiro, com:
1. Cabeçalho completo
2. Registro de abertura
3. Verificação de quórum
4. Leitura de expedientes
5. Ordem do dia e votações
6. Encerramento
7. Assinaturas (deixar espaço)

A ata deve ser formal, clara e registrar todos os fatos relevantes da sessão.
`
  }

  /**
   * Faz a chamada à API do Gemini
   */
  private async callGemini(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY não configurada')
    }

    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
        })
      })

      if (!response.ok) {
        const error = await response.text()
        console.error('[Gemini] Erro na API:', error)
        throw new Error(`Erro na API Gemini: ${response.status}`)
      }

      const data = await response.json()
      
      if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        throw new Error('Resposta inválida da API Gemini')
      }

      return data.candidates[0].content.parts[0].text
    } catch (error) {
      console.error('[Gemini] Erro:', error)
      throw error
    }
  }

  /**
   * Faz o parse da resposta da IA para matéria
   */
  private parseMateriaResponse(response: string, context: PromptContext): MateriaGerada {
    try {
      // Remove possíveis backticks de markdown
      let jsonStr = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

      const parsed = JSON.parse(jsonStr)

      return {
        tipo: context.tipo,
        numero: '', // Será gerado pelo sistema
        ementa: parsed.ementa || '',
        justificativa: parsed.justificativa || '',
        texto: parsed.texto || '',
        autor: context.vereador,
        partido: context.partido,
        municipio: context.municipio,
        data: context.data || new Date().toLocaleDateString('pt-BR')
      }
    } catch (error) {
      console.error('[Gemini] Erro ao parsear resposta:', error)
      console.error('[Gemini] Resposta:', response)
      
      // Tenta extrair manualmente
      return {
        tipo: context.tipo,
        numero: '',
        ementa: this.extractSection(response, 'EMENTA'),
        justificativa: this.extractSection(response, 'JUSTIFICATIVA'),
        texto: response,
        autor: context.vereador,
        partido: context.partido,
        municipio: context.municipio,
        data: context.data || new Date().toLocaleDateString('pt-BR')
      }
    }
  }

  /**
   * Extrai seção de texto quando JSON falha
   */
  private extractSection(text: string, section: string): string {
    const regex = new RegExp(`${section}[:\\s]*([\\s\\S]*?)(?=\\n\\n|JUSTIFICATIVA|TEXTO|$)`, 'i')
    const match = text.match(regex)
    return match ? match[1].trim() : ''
  }
}

export default new GeminiService()
