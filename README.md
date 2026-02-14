# GetPonto - Sistema de Ponto Eletrônico

> Sistema completo de controle de ponto eletrônico para órgãos públicos e empresas privadas, em conformidade com a **Portaria 671/2021 do MTE**.

**Produção:** https://getponto.inf.br

---

## Índice

- [Visão Geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [API](#api)
- [Portaria 671](#portaria-671)
- [Troubleshooting](#troubleshooting)

---

## Visão Geral

### URLs de Produção

| Serviço | URL |
|---------|-----|
| Aplicação | https://getponto.inf.br |
| Supabase | https://supabase.getponto.inf.br |

### Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Backend | AdonisJS 6 (Node.js, TypeScript) |
| Frontend | Edge templates + Bootstrap 5 + DataTables |
| Banco de Dados | PostgreSQL (Supabase) - Multi-tenant por schema |
| Reconhecimento Facial | DeepFace API (Python/FastAPI) - Modelo ArcFace |
| Biometria Digital | REP Control iD + Futronic FS80H |
| Tempo Real | Socket.io (WebSocket) |
| Deploy | Coolify + Docker + Traefik |

---

## Funcionalidades

### Registro de Ponto
- Integração com REP Control iD (biometria digital)
- Reconhecimento facial via DeepFace (99.5% precisão)

### Atendimentos e Visitas Domiciliares
- **App Mobile** para agentes de saúde e visitadores
- Registro de início/fim de visita com GPS automático
- **Geocoding reverso** - endereço preenchido automaticamente pela localização
- **Mapa interativo** (Leaflet/OpenStreetMap) com visualização de todas as visitas
- Filtro por funcionário no mapa
- **Cerca eletrônica (Geofence)** para registro de ponto:
  - Define área permitida para os funcionários baterem o ponto
  - Configuração de latitude, longitude e raio (em metros)
  - Opção de bloquear ou apenas registrar quando fora da cerca
  - Configurável em: Configurações > Mapa e Geolocalização
- Configuração de:
  - Centro e zoom inicial do mapa
  - Raio da cerca eletrônica (em metros)
  - Metas diárias, semanais e mensais por funcionário/cargo/lotação
- Cards de resumo com barras de progresso
- Modal de detalhes com mapa da localização
- Timer de duração da visita em andamento
- Exportação de relatórios


- Leitor de digital USB Futronic FS80H
- Terminal facial com comandos de voz
- Suporte a plantões e horários corridos

### Gestão de Funcionários
- Cadastro completo com foto e biometria
- Jornadas configuráveis (normal, plantão, corrida)
- Tolerâncias de entrada/saída
- Lotação, cargo e vínculo

### Banco de Horas
- Crédito/débito automático
- Compensação de horas
- Workflow de aprovação
- Exportação CSV/Excel


### Escala de Trabalho (Unificada)
- **Plantões**: Escalas por turno (diurno, noturno, 12x36, 24x72)

### Gerador Automático de Escalas
- **Geração automática** de escalas de plantão por período
- **Tipos suportados**: 12x36 (2 turnos), 24x48, 24x72, Diário
- **Distribuição inteligente** em equipes que se alternam
- **Turnos**: Diurno (07:00-19:00) e Noturno (19:00-07:00) para 12x36
- **Atualização automática** da jornada dos funcionários
- **Preview visual** antes de salvar
- **Verificação de escalas existentes** no período
- **Folgas**: Programadas e compensatórias
- **Compensações**: Vinculadas ao banco de horas
- **Sobreaviso e Treinamento**
- Calendário visual com cores por tipo
- Substituição de plantões entre funcionários

### Afastamentos e INSS
- Férias, licenças médicas, atestados
- Workflow de aprovação (pendente → aprovado/rejeitado)
- **Cálculo automático INSS**:
  - 15 primeiros dias: empresa paga
  - 16º dia em diante: INSS paga (B31)
  - Acidente de trabalho: INSS desde o 1º dia (B91)
- **Geração de XML eSocial S-2230**:
  - Motivo 01: Doença não relacionada ao trabalho
  - Motivo 03: Acidente de trabalho
  - Motivo 17: Licença maternidade
- Registro de número do benefício e recibo eSocial

### Espelho de Ponto
- Visualização mensal
- Cálculo automático de atrasos
- Aprovação por supervisor
- Exportação PDF/Excel

### Relatórios (Portaria 671)
- AFD (Arquivo Fonte de Dados)
- AEJ (Arquivo Eletrônico de Jornada)
- Frequência por período
- Horas extras
- eSocial (S-1200, S-2230, AFDT)

### Administração
- Multi-tenant (múltiplos municípios/entidades)
- Autenticação 2FA via SMS
- Auditoria completa
- Notificações em tempo real

---

## Arquitetura

### Estrutura de Diretórios

```
ponto-eletronico/
├── app/
│   ├── controllers/          # Controladores HTTP
│   ├── middleware/           # Middlewares (Auth, Tenant, etc)
│   ├── models/               # Modelos Lucid ORM
│   └── services/             # Serviços de negócio
├── config/                   # Configurações AdonisJS
├── database/
│   └── migrations/tenant/    # Schema do tenant (schema_municipio.sql)
├── deepface-api/             # Microserviço de reconhecimento facial
├── resources/views/          # Templates Edge
├── scripts/                  # Scripts de sincronização REP
└── start/routes.ts           # Rotas da aplicação
```

### Multi-Tenant

O sistema usa **isolamento por schema PostgreSQL**. Cada município/entidade tem seu próprio schema.

```
┌─────────────────────────────────────────┐
│              PostgreSQL                  │
├─────────────────────────────────────────┤
│  public (banco central)                  │
│    ├── municipios                        │
│    ├── usuarios_master                   │
│    └── entidades                         │
├─────────────────────────────────────────┤
│  santo_andre (tenant 1)                  │
│    ├── funcionarios                      │
│    ├── registros_ponto                   │
│    └── ...                               │
├─────────────────────────────────────────┤
│  outro_municipio (tenant 2)              │
│    ├── funcionarios                      │
│    └── ...                               │
└─────────────────────────────────────────┘
```

### Containers Docker

| Container | Porta | Descrição |
|-----------|-------|-----------|
| ponto-eletronico | 3000 | Aplicação principal |
| deepface-api | 5000 | API de reconhecimento facial |
| supabase-kong | 8000 | API Gateway Supabase |
| supabase-db | 5432 | PostgreSQL |
| supabase-studio | 3000 | Interface admin do Supabase |

---

## Instalação

### Pré-requisitos

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+ (ou Supabase)

### Desenvolvimento Local

```bash
# Clone o repositório
git clone https://github.com/luizmiguelladv-max/ponto-eletronico.git
cd ponto-eletronico

# Instale dependências
npm install

# Configure variáveis de ambiente
cp .env.example .env

# Inicie todos os serviços
npm run dev
```

Isso inicia automaticamente:
- Servidor AdonisJS (porta 3333)
- WebSocket (Socket.IO)
- DeepFace API (porta 5000)
- REP Proxy (porta 3334)
- Sincronização REP (polling 5s)

---

## Configuração

### Variáveis de Ambiente

```bash
# Servidor
TZ=America/Sao_Paulo
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Banco de Dados
DB_HOST=supabase-db-xxx
DB_PORT=5432
DB_USER=supabase_admin
DB_PASSWORD=***
DB_DATABASE=postgres
DB_SSL=false

# Supabase
SUPABASE_URL=https://supabase.getponto.inf.br
SUPABASE_ANON_KEY=***
SUPABASE_SERVICE_KEY=***

# Serviços
DEEPFACE_URL=http://deepface-api:5000
JWT_SECRET=***
```

---

## Uso

### Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Inicia em modo desenvolvimento |
| `npm run build` | Build para produção |
| `npm start` | Executa build de produção |

### Scripts REP (pasta /scripts)

```bash
# Sincronização contínua (5 segundos)
node --insecure-http-parser scripts/servico-sincronizacao.mjs

# Importar AFD do REP
node --insecure-http-parser scripts/buscar-afd-rep.mjs 2024-12-13

# Enviar funcionários para o REP
node --insecure-http-parser scripts/sincronizar-rep.mjs
```

---

## API

### Endpoints Principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/auth/login` | Autenticação |
| GET | `/api/dashboard` | Dados do dashboard |
| GET | `/api/funcionarios` | Lista funcionários |
| POST | `/api/terminal/registrar` | Registra ponto facial |
| POST | `/api/webhook/controlid` | Webhook REP |
| GET | `/api/escalas` | Lista escalas (plantões, folgas) |
| POST | `/api/escalas` | Cria nova escala |
| PUT | `/api/escalas/:id` | Atualiza escala |
| DELETE | `/api/escalas/:id` | Remove escala |
| GET | `/api/afastamentos/:id/calculo-inss` | Calcula dias empresa/INSS |
| POST | `/api/afastamentos/:id/gerar-s2230` | Gera XML eSocial S-2230 |
| PUT | `/api/afastamentos/:id/confirmar-inss` | Confirma envio ao eSocial |

### WebSocket

```javascript
// Conectar
const socket = io({ path: '/ws' });

// Inscrever no município
socket.emit('subscribe', municipioId);

// Escutar novas batidas
socket.on('nova-batida', (data) => {
  console.log('Nova batida:', data);
});
```

---

## Portaria 671

O sistema gera arquivos em conformidade com a Portaria 671/2021 do MTE.

### AFD (Arquivo Fonte de Dados)

```
Tipo 1: Cabeçalho (223 caracteres)
Tipo 3: Marcação (34 caracteres) - NSR + Data + Hora + PIS
Tipo 9: Trailer (contadores)
```

### AEJ (Arquivo Eletrônico de Jornada)

```
Tipo 1: Cabeçalho (194 caracteres) - CNPJ, Razão Social, Período
Tipo 2: Trabalhador (76 caracteres) - CPF, PIS, Nome
Tipo 3: Marcações (73 caracteres) - Data + até 16 marcações
Tipo 9: Trailer (19 caracteres) - Contadores
```

### Tabelas de Biometria

| Tabela | Descrição |
|--------|-----------|
| `digitais_funcionarios` | Templates de digitais |
| `funcionarios_fotos` | Fotos para reconhecimento facial |
| `registros_ponto` | Batidas com NSR e origem |

### Tabela Espelhos de Ponto

A tabela `espelhos_ponto` deve conter as seguintes colunas:

```sql
-- Colunas obrigatórias (adicionar em todos os schemas de tenant)
ALTER TABLE {schema}.espelhos_ponto ADD COLUMN IF NOT EXISTS dias_trabalhados INTEGER DEFAULT 0;
ALTER TABLE {schema}.espelhos_ponto ADD COLUMN IF NOT EXISTS horas_faltantes VARCHAR(10) DEFAULT '00:00';
ALTER TABLE {schema}.espelhos_ponto ADD COLUMN IF NOT EXISTS dados JSONB;
```

### Tabelas de Plantão

| Tabela | Descrição |
|--------|-----------|
| `setores_lotacao` | Setores de plantão por lotação |
| `funcionarios_setor` | Vínculo funcionário-setor |
| `escalas_plantao` | Períodos de escala |
| `plantoes` | Plantões individuais gerados |

---

## Troubleshooting

### ⚠️ IMPORTANTE: Sincronização de Schemas Multi-Tenant

**Ao modificar a estrutura do banco de dados (adicionar/remover tabelas, colunas, etc.), SEMPRE aplique as alterações em TODOS os schemas de tenant.**

Os schemas de tenant atualmente são:
- `santo_andre_prefeitura`
- `nova_floresta_adrielly_de_castro_silva_olive`

**Exemplo de migração correta:**

```sql
-- Aplicar em TODOS os schemas
DO $$
DECLARE
    schema_name TEXT;
    schemas TEXT[] := ARRAY['santo_andre_prefeitura', 'nova_floresta_adrielly_de_castro_silva_olive'];
BEGIN
    FOREACH schema_name IN ARRAY schemas
    LOOP
        EXECUTE format('ALTER TABLE %I.funcionarios ADD COLUMN IF NOT EXISTS nova_coluna VARCHAR(100)', schema_name);
    END LOOP;
END $$;
```

**Verificar consistência entre schemas:**

```sql
-- Listar tabelas de cada schema
SELECT table_schema, table_name 
FROM information_schema.tables 
WHERE table_schema IN ('santo_andre_prefeitura', 'nova_floresta_adrielly_de_castro_silva_olive')
ORDER BY table_schema, table_name;
```

**Consequências de schemas inconsistentes:**
- Erro 500 ao tentar operações em entidades com estrutura diferente
- Funcionalidades que funcionam em um tenant mas falham em outro
- Dificuldade de manutenção e debug

---

### Erro "Expected 1 bindings, saw 0"

```sql
-- ERRADO (Knex interpreta como placeholder)
NULLIF(nsr, '')

-- CERTO
CASE WHEN nsr = '' THEN NULL ELSE nsr END
```

### Loop de redirecionamento no login

Verificar `config/auth.ts`:
```typescript
web: sessionGuard({
  useRememberMeTokens: false,  // Deve ser false
})
```

### REP não envia batidas em tempo real

Usar polling como alternativa ao webhook:
```bash
node --insecure-http-parser scripts/servico-sincronizacao.mjs
```

### Entidade não carrega funcionários / Erro de conexão ECONNREFUSED

Se uma entidade mostra erro de conexão com um IP externo mesmo com `db_host` correto:

**Causa:** O campo `db_connection_string` tem prioridade sobre os campos individuais (`db_host`, `db_port`, etc.). Se esse campo contiver um IP/host antigo, o sistema usará ele.

**Solução:**
```sql
-- Verificar configuração atual
SELECT id, nome, db_host, db_connection_string
FROM public.entidades WHERE id = <ENTIDADE_ID>;

-- Corrigir a connection string para usar o host correto
UPDATE public.entidades
SET db_connection_string = 'postgresql://<user>:<password>@<HOST_CORRETO>:5432/postgres'
WHERE id = <ENTIDADE_ID>;

-- Reiniciar o servidor após a correção
docker restart ponto-eletronico-po88s8sk4ocgogc4okkk0o0w
```

**Prevenção:** Ao criar novas entidades, garantir que `db_connection_string` use o hostname do Docker (`supabase-db-iko0so8wc0wwsws04w4ws0w4`) e não IPs externos.

---

## Health Checks

```bash
# Aplicação
curl https://getponto.inf.br/api/health

# DeepFace
curl http://localhost:5000/health

# Supabase
curl https://supabase.getponto.inf.br/rest/v1/
```

---

## Agente Local (Sincronização REP)

O sistema inclui um agente Windows para sincronizar REPs Control iD que estão na rede local do cliente.

### Instalação do Agente

1. Baixe o instalador: `https://getponto.inf.br/downloads/agente/INSTALAR.bat`
2. Execute como Administrador
3. Digite a API Key da entidade quando solicitado
4. O agente será configurado para iniciar automaticamente com o Windows

### Arquivos do Agente

| Arquivo | Descrição |
|---------|-----------|
| `INSTALAR.bat` | Instalador automático (baixa Node.js se necessário) |
| `atualizar.bat` | Atualiza o agente para última versão |
| `agente.js` | Script principal de sincronização |
| `config.json` | Configurações (servidor, API Key, intervalo) |

### Localização

- **Instalação:** `C:\ProgramData\GetPonto-Agente\`
- **Log:** `C:\ProgramData\GetPonto-Agente\agente.log`
- **Startup:** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\GetPonto-Agente.vbs`

### Configuração

O agente lê a configuração `data_inicial_registros` do banco de dados para filtrar registros antigos.

```sql
-- Verificar configuração atual
SELECT chave, valor FROM {schema}.configuracoes_sistema
WHERE chave = 'data_inicial_registros';

-- Atualizar data inicial
UPDATE {schema}.configuracoes_sistema
SET valor = '2026-01-14'
WHERE chave = 'data_inicial_registros';
```

### Comandos Úteis

```batch
:: Verificar se está rodando
tasklist | findstr node

:: Ver logs
type "C:\ProgramData\GetPonto-Agente\agente.log"

:: Parar o agente
taskkill /f /im node.exe

:: Iniciar manualmente
cd C:\ProgramData\GetPonto-Agente
node --insecure-http-parser agente.js
```

---

## Deploy em Produção

### Container Docker

| Container | Descrição |
|-----------|-----------|
| `ponto-eletronico-po88s8sk4ocgogc4okkk0o0w` | Aplicação AdonisJS |
| `supabase-db-iko0so8wc0wwsws04w4ws0w4` | PostgreSQL (banco ponto) |

### Atualização de Código

**IMPORTANTE:** O AdonisJS compila TypeScript para JavaScript. Após alterar arquivos `.ts`, é necessário rebuild.

```bash
# 1. Atualizar código fonte
docker exec ponto-eletronico-po88s8sk4ocgogc4okkk0o0w sh -c "cd /app && git pull"

# 2. Recompilar (OBRIGATÓRIO para alterações em .ts)
docker exec ponto-eletronico-po88s8sk4ocgogc4okkk0o0w sh -c "cd /app && node ace build --ignore-ts-errors"

# 3. Reiniciar servidor
docker restart ponto-eletronico-po88s8sk4ocgogc4okkk0o0w
```

### Apenas Templates Edge

Para alterações apenas em arquivos `.edge` (templates), basta o git pull:

```bash
docker exec ponto-eletronico-po88s8sk4ocgogc4okkk0o0w sh -c "cd /app && git pull"
# Não precisa rebuild nem restart - Edge é interpretado em runtime
```

### Verificar Logs

```bash
# Logs do servidor
docker logs ponto-eletronico-po88s8sk4ocgogc4okkk0o0w --tail 50

# Logs em tempo real
docker logs -f ponto-eletronico-po88s8sk4ocgogc4okkk0o0w
```

---

## Licença

Proprietary - Todos os direitos reservados.

---

## Changelog

### [2026-01-25] Gerador Automático de Escalas
- **Nova funcionalidade**: Gerador automático de escalas de plantão (`/gerador-escalas`)
- Suporte a escalas 12x36, 24x48, 24x72 e diário
- Divisão automática em equipes com turnos alternados
- Preview visual com distribuição por funcionário
- Atualização automática da jornada ao salvar
- Código automático para novas lotações



### 24/01/2026
- **Escala de Trabalho Unificada**: Nova tela `/escalas` que unifica:
  - Plantões (diurno, noturno, 12x36, 24x72)
  - Folgas programadas
  - Compensações de banco de horas
  - Sobreaviso e treinamento
  - Calendário visual com cores por tipo
  - Migração automática de `folgas_programadas` e `plantoes` para nova tabela `escalas`
- **INSS e eSocial S-2230**: Sistema completo de cálculo e geração:
  - Cálculo automático dos 15 dias pagos pela empresa
  - A partir do 16º dia, INSS assume (benefício B31)
  - Acidente de trabalho: INSS desde o 1º dia (benefício B91)
  - Geração de XML S-2230 pronto para envio ao eSocial
  - Novos campos na tabela `afastamentos`:
    - `dias_empresa`, `data_inicio_inss`, `numero_beneficio`
    - `tipo_beneficio`, `esocial_enviado`, `esocial_recibo`, `esocial_xml`
    - `acidente_trabalho` (checkbox na interface)
  - Modal de cálculo com visualização empresa vs INSS
  - Botão na tabela de afastamentos (aparece quando > 15 dias e aprovado)
- **Novos Endpoints de API**:
  - `GET /api/escalas` - Lista escalas por mês/ano
  - `POST /api/escalas` - Cria nova escala
  - `PUT /api/escalas/:id` - Atualiza escala
  - `DELETE /api/escalas/:id` - Remove escala
  - `GET /api/afastamentos/:id/calculo-inss` - Calcula dias empresa/INSS
  - `POST /api/afastamentos/:id/gerar-s2230` - Gera XML eSocial S-2230
  - `PUT /api/afastamentos/:id/confirmar-inss` - Registra envio ao eSocial


### 15/01/2026
- **Agente Local Windows**: Sistema de sincronização de REPs Control iD via rede local
  - Instalador automático (`INSTALAR.bat`) com download de Node.js
  - Execução em segundo plano (sem janela) via VBS
  - Início automático com Windows (pasta Startup)
  - Suporte a certificados SSL auto-assinados (Control iD)
  - Parser de AFD texto para formato Control iD
  - Envio em lotes (500 registros por vez) para evitar erro 413
  - Filtro por data inicial (`data_inicial_registros`)
- **Sincronização de Templates Biométricos**: Compartilhamento de digitais entre REPs
  - Nova tabela `funcionario_templates` para armazenar templates de digitais
  - `POST /api/agente/digitais` aceita 2 formatos:
    - Formato 1 (status): `{ digitais: [{ pis, tem_digital, qtd_digitais }] }`
    - Formato 2 (templates): `{ templates: [{ pis, templates: [{ finger_id, template }] }] }`
  - `GET /api/agente/digitais` retorna templates para sincronizar com outros REPs
  - Permite que REP A envie templates para servidor, e REP B baixe e cadastre
- **API do Agente**: Novos endpoints para comunicação com agente local
  - `GET /api/agente/equipamentos` - Lista equipamentos com data inicial
  - `POST /api/agente/registros` - Recebe registros em lote
  - `GET /api/agente/funcionarios` - Lista funcionários para sincronizar com REP
  - `POST /api/agente/digitais` - Recebe templates biométricos
  - `GET /api/agente/digitais` - Retorna templates para enviar a outros REPs
  - Autenticação via API Key da entidade
- **Configurações**: Correção no carregamento da data inicial
  - Dados agora são passados do servidor (server-side rendering)
  - Correção de parsing de data ISO para formato brasileiro
  - Rota `/configuracoes` busca valor do banco e passa para view
- **Página Ponto Eletrônico**: Melhoria nos filtros de data
  - Filtro de data agora inicia do 1º dia do mês até hoje (ao invés de apenas hoje)
  - Botão "Limpar Filtros" reseta para o mesmo padrão
- **Página Espelho de Ponto**: Novos filtros hierárquicos
  - Adicionado filtro de Secretaria/Departamento
  - Adicionado filtro de Lotação/Setor
  - Filtros em cascata: Secretaria → Lotação → Funcionário
  - Terminologia dinâmica conforme tipo de entidade (Pública/Privada)
  - API atualizada para suportar novos parâmetros de filtro

### 12/01/2026
- **Escala de Plantões**: Novo módulo completo para gestão de plantões
  - Cadastro de setores por lotação
  - Atribuição de funcionários aos setores
  - Geração automática de escalas
  - Visualização em calendário
- **Espelho de Ponto**: Correções importantes no cálculo
  - Adicionadas colunas `dias_trabalhados`, `horas_faltantes` e `dados` na tabela `espelhos_ponto`
  - Correção no parsing de DateTime (PostgreSQL Date → Luxon)
  - **Correção de timezone**: Registros noturnos (ex: 22:30) agora são agrupados no dia correto
    - Todas as conversões de data usam timezone `America/Sao_Paulo` explicitamente
    - Corrigido endpoint `/api/ponto/espelho` que recalculava com UTC
  - **Registros do dia atual**: Alterado de `startOf('day')` para `endOf('day')` para incluir registros feitos durante o dia
  - **Turnos que cruzam fechamento**: Horas são divididas automaticamente entre períodos
    - Horas até 23:59:59 do dia de fechamento → período atual
    - Horas de 00:00:00 em diante → próximo período
    - Funciona para qualquer jornada (NORMAL, PLANTAO, CORRIDA)
    - Exibe observação "TURNO CRUZA FECHAMENTO" no espelho
- **Melhorias de UI**:
  - Datepicker (flatpickr) nos campos de data
  - Notificações toastr em vez de alerts
  - Simplificação do cadastro de setores

### 01/01/2026
- Migração para domínio `getponto.inf.br`
- Correção do dashboard (digitais, presentes, gráfico)
- Validação AFD/AEJ conforme Portaria 671

### 22/12/2024
- Correção de cards para dark mode
- Terminologia dinâmica por tipo de entidade

### 20/12/2024
- Correção de autenticação 2FA
- Validação de CNPJ com BrasilAPI

### 14/12/2024
- Sistema de cache em memória
- Captura de digitais com 3 amostras
- Inicialização automática de serviços
