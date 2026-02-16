import vine from '@vinejs/vine'
import { FieldContext } from '@vinejs/vine/types'

/**
 * Valida PIS/PASEP/NIT
 * 
 * Formato aceito: 000.00000.00-0 ou 00000000000
 * 
 * @param value - Valor a ser validado
 * @param options - Opções de validação
 * @param field - Contexto do campo
 */
function pisValidation(value: unknown, options: any, field: FieldContext) {
  if (typeof value !== 'string') {
    field.report('O PIS deve ser uma string', 'pis', field)
    return
  }

  // Remove caracteres não numéricos
  const cleanedPis = value.replace(/[^\d]/g, '')

  // Verifica se tem 11 dígitos
  if (cleanedPis.length !== 11) {
    field.report('O PIS deve ter 11 dígitos', 'pis', field)
    return
  }

  // Verifica se todos os dígitos são iguais (PIS inválido)
  if (/^(\d)\1+$/.test(cleanedPis)) {
    field.report('PIS inválido', 'pis', field)
    return
  }

  // Validação do dígito verificador
  const multiplicadores = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let soma = 0

  for (let i = 0; i < 10; i++) {
    soma += parseInt(cleanedPis.charAt(i)) * multiplicadores[i]
  }

  const resto = soma % 11
  const digitoVerificador = resto < 2 ? 0 : 11 - resto

  if (digitoVerificador !== parseInt(cleanedPis.charAt(10))) {
    field.report('PIS inválido', 'pis', field)
    return
  }
}

/**
 * Regra de validação de PIS para VineJS
 */
export const pisRule = vine.createRule(pisValidation)

/**
 * Helper para validar PIS em schemas
 * 
 * @example
 * ```typescript
 * import { pis } from '#validators/shared/pis_validator'
 * 
 * const schema = vine.object({
 *   pis: pis()
 * })
 * ```
 */
export function pis() {
  return vine.string().trim().use(pisRule())
}

/**
 * Formata PIS para exibição
 * 
 * @param pisStr - PIS sem formatação
 * @returns PIS formatado (000.00000.00-0)
 */
export function formatPis(pisStr: string): string {
  const cleaned = pisStr.replace(/[^\d]/g, '')
  if (cleaned.length !== 11) return pisStr
  
  return cleaned.replace(/^(\d{3})(\d{5})(\d{2})(\d{1})$/, '$1.$2.$3-$4')
}

/**
 * Remove formatação do PIS
 * 
 * @param pisStr - PIS formatado
 * @returns PIS apenas com números
 */
export function cleanPis(pisStr: string): string {
  return pisStr.replace(/[^\d]/g, '')
}
