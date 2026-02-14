# Agente Local GetPonto

Agente para sincronizar REPs (Relógios Eletrônicos de Ponto) em redes locais com o servidor GetPonto na nuvem.

## Requisitos

- Windows 7 ou superior
- Node.js 18 ou superior (https://nodejs.org)
- Acesso à rede onde estão os REPs

## Instalação

1. Copie esta pasta para o computador na rede local
2. Execute `instalar.bat` (clique duplo)
3. Execute `iniciar.bat` (clique duplo)

Na primeira execução, o agente irá pedir:
- **API Key**: Chave de integração da unidade gestora (obtida no painel GetPonto)
- **Intervalo**: Tempo entre sincronizações (padrão: 60 segundos)

## Como obter a API Key

1. Acesse o painel GetPonto (https://getponto.inf.br)
2. Faça login como administrador
3. Vá em **Configurações → Integração**
4. Copie a **API Key** da sua unidade gestora

## Executar como serviço Windows

Para que o agente inicie automaticamente com o Windows:

1. Execute `instalar-servico.bat` **como Administrador**
2. O agente será instalado como serviço

## Logs

Os logs são salvos em `agente.log` na mesma pasta do agente.

## Suporte

Em caso de problemas, verifique:
1. Se o Node.js está instalado corretamente
2. Se a API Key está correta
3. Se os REPs estão acessíveis na rede (ping no IP)
4. Os logs em `agente.log`
