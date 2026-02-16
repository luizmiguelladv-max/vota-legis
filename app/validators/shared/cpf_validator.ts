import vine from '@vinejs/vine'
import { FieldContext } from '@vinejs/vine/types'

/**
 * Valida CPF (Cadastro de Pessoa Física)
 * 
 * Formato aceito: 000.000.000-00 ou 00000000000
 * 
 * @param value - Valor a ser validado
 * @param options - Opções de validação
 * @param field - Contexto do campo
 */
function cpfValidation(value: unknown, options: any, field: FieldContext) {
  if (typeof value !== 'string') {
    field.report('O CPF deve ser uma string', 'cpf', field)
    return
  }

  // Remove caracteres não numéricos
  const cleanedCpf = value.replace(/[^\d]/g, '')

  // Verifica se tem 11 dígitos
  if (cleanedCpf.length !== 11) {
    field.report('O CPF deve ter 11 dígitos', 'cpf', field)
    return
  }

  // Verifica se todos os dígitos são iguais (CPF inválido)
  if (/^(\d)\1+$/.test(cleanedCpf)) {
    field.report('CPF inválido', 'cpf', field)
    return
  }

  // Validação do primeiro dígito verificador
  let soma = 0
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cleanedCpf.charAt(i)) * (10 - i)
  }
  let resto = 11 - (soma % 11)
  let digitoVerificador1 = resto === 10 || resto === 11 ? 0 : resto

  if (digitoVerificador1 !== parseInt(cleanedCpf.charAt(9))) {
    field.report('CPF inválido', 'cpf', field)
    return
  }

  // Validação do segundo dígito verificador
  soma = 0
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cleanedCpf.charAt(i)) * (11 - i)
  }
  resto = 11 - (soma % 11)
  let digitoVerificador2 = resto === 10 || resto === 11 ? 0 : resto

  if (digitoVerificador2 !== parseInt(cleanedCpf.charAt(10))) {
    field.report('CPF inválido', 'cpf', field)
    return
  }
}

/**
 * Regra de validação de CPF para VineJS
 */
export const cpfRule = vine.createRule(cpfValidation)

/**
 * Helper para validar CPF em schemas
 * 
 * @example
 * ```typescript
 * import { cpf } from '#validators/shared/cpf_validator'
 * 
 * const schema = vine.object({
 *   cpf: cpf()
 * })
 * ```
 */
export function cpf() {
  return vine.string().trim().use(cpfRule())
}

/**
 * Formata CPF para exibição
 * 
 * @param cpfStr - CPF sem formatação
 * @returns CPF formatado (000.000.000-00)
 */
export function formatCpf(cpfStr: string): string {
  const cleaned = cpfStr.replace(/[^\d]/g, '')
  if (cleaned.length !== 11) return cpfStr
  
  return cleaned.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

/**
 * Remove formatação do CPF
 * 
 * @param cpfStr - CPF formatado
 * @returns CPF apenas com números
 */
export function cleanCpf(cpfStr: string): string {
  return cpfStr.replace(/[^\d]/g, '')
}
