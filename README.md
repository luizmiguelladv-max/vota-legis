# VotaLegis - Sistema de Votacao Legislativa

Sistema completo para gerenciamento de votacoes em camaras municipais, desenvolvido com AdonisJS 6.

## URL de Producao

- **Portal**: https://votacao.mdevelop.com.br
- **Login**: https://votacao.mdevelop.com.br/login

## Credenciais Padrao

- **Login**: master
- **Senha**: admin123
- **Perfil**: Super Admin

## Tecnologias

- **Backend**: AdonisJS 6 (Node.js + TypeScript)
- **Frontend**: Edge.js + Bootstrap 5
- **Banco de Dados**: PostgreSQL (Supabase)
- **Autenticacao**: Session-based com suporte a 2FA via SMS
- **Deploy**: Docker + Coolify
- **Proxy**: Traefik

## Funcionalidades

### Portal Publico (Landing Page)
- Apresentacao do sistema
- Funcionalidades e modulos
- Contato
- Acesso ao sistema

### Autenticacao
- Login com usuario/senha
- Autenticacao em Dois Fatores (2FA) via SMS (Comtele)
- Dispositivos confiaveis (30 dias sem 2FA)
- Multi-tenant (multiplas camaras)

### Gestao de Camaras (Multi-tenant)
- Cadastro de municipios/camaras
- Cores personalizaveis por camara
- Logo personalizado
- **Criacao automatica de schema por camara** (isolamento de dados)

### Sistema de Votacao
- Votacao Nominal (voto aberto)
- Votacao Secreta (voto sigiloso)
- Votacao Simbolica
- Painel eletronico em tempo real
- Historico de votacoes

### Gestao de Sessoes
- Tipos: Ordinaria, Extraordinaria, Solene, Especial
- Estados: Agendada, Em Andamento, Suspensa, Encerrada, Cancelada
- Controle de presencas (quorum)
- Pauta de materias

### Gestao de Vereadores
- Cadastro completo
- Vinculacao com partidos e legislaturas
- Foto do vereador
- Historico de votos

### Gestao de Materias
- Projetos de Lei (Ordinaria, Complementar)
- Resolucoes, Decretos Legislativos
- Mocoes, Requerimentos, Indicacoes
- Tramitacao e pareceres

### Tempo de Fala
- Pequeno/Grande Expediente
- Explicacao Pessoal
- Aparte, Questao de Ordem
- Cronometro com alertas

## Arquitetura Multi-tenant

O sistema usa **schemas separados** no PostgreSQL para isolar os dados de cada camara:

```
postgres/
├── public/           # Tabelas globais (usuarios, municipios, perfis)
├── camara_1/         # Schema da Camara 1
│   ├── partidos
│   ├── legislaturas
│   ├── vereadores
│   ├── sessoes
│   ├── votacoes
│   └── ...
├── camara_2/         # Schema da Camara 2
│   └── ...
└── camara_N/         # Schema da Camara N
```

### Tabelas por Schema (Camara)

| Tabela | Descricao |
|--------|-----------|
| partidos | Partidos politicos |
| legislaturas | Periodos legislativos |
| vereadores | Parlamentares |
| sessoes | Sessoes plenarias |
| sessao_presencas | Registro de presenca |
| tipos_materia | Tipos de proposicao |
| materias | Projetos e proposicoes |
| votacoes | Votacoes realizadas |
| votos | Votos individuais |

## Instalacao Local

```bash
# Clonar repositorio
git clone https://github.com/luizmiguelladv-max/vota-legis.git
cd vota-legis

# Instalar dependencias
npm install

# Configurar variaveis de ambiente
cp .env.example .env
# Editar .env com as credenciais do banco

# Rodar migrations
node ace migration:run

# Rodar seeders (perfis e usuario master)
node ace db:seed

# Iniciar servidor de desenvolvimento
npm run dev
```

## Setup Producao (Coolify + Supabase unico)

Fluxo recomendado (sem reutilizar municipios/dados do sistema de ponto):

1. Crie um projeto Supabase/Postgres vazio para o VotaLegis.
2. No Coolify, crie uma Application apontando para este repo e configure as env vars do banco.
3. No primeiro deploy, execute seeders (perfis + master):
   - defina `RUN_SEEDERS=true` e faça um deploy.
   - depois volte `RUN_SEEDERS=false` (para nao tentar recriar dados a cada deploy).
4. Acesse com `master / admin123`, cadastre seus municipios (camaras) e crie os schemas `camara_<id>` pelo proprio sistema.

## Deploy com Docker

### Build da imagem

```bash
docker build -t votacao-legislativa:latest .
```

### Executar container

```bash
docker run -d \
  --name votacao-legislativa \
  --network <rede-do-supabase> \
  --restart unless-stopped \
  -e TZ=America/Fortaleza \
  -e PORT=3333 \
  -e HOST=0.0.0.0 \
  -e LOG_LEVEL=info \
  -e NODE_ENV=production \
  -e SESSION_DRIVER=cookie \
  -e APP_KEY=<sua-chave> \
  -e DB_CONNECTION=pg \
  -e DB_HOST=<host-supabase> \
  -e DB_PORT=5432 \
  -e DB_USER=<usuario> \
  -e DB_PASSWORD=<senha> \
  -e DB_DATABASE=postgres \
  -e DB_SSL=false \
  -e RUN_SEEDERS=true \
  votacao-legislativa:latest
```

## Variaveis de Ambiente

```env
# Aplicacao
TZ=America/Fortaleza
PORT=3333
HOST=0.0.0.0
LOG_LEVEL=info
NODE_ENV=production
SESSION_DRIVER=cookie
APP_KEY=<chave-base64>

# Banco de Dados
DB_CONNECTION=pg
DB_HOST=<host>
DB_PORT=5432
DB_USER=<usuario>
DB_PASSWORD=<senha>
DB_DATABASE=postgres
DB_SSL=false

# SMS (Comtele)
COMTELE_API_KEY=<api-key>

# Docker
RUN_SEEDERS=false
```

## Estrutura do Projeto

```
votacao-eletronica/
├── app/
│   ├── controllers/        # Controllers
│   ├── middleware/         # Middlewares (auth, tenant)
│   ├── models/             # Models Lucid ORM
│   ├── services/           # Servicos (2FA, SMS, Tenant)
│   └── validators/         # Validadores
├── database/
│   ├── migrations/         # Migrations (tabelas globais)
│   └── seeders/            # Seeders (dados iniciais)
├── resources/
│   └── views/
│       ├── layouts/        # Layouts base
│       ├── pages/          # Paginas
│       └── partials/       # Componentes
├── start/
│   ├── routes.ts           # Rotas
│   └── kernel.ts           # Middlewares globais
├── Dockerfile              # Build Docker
├── docker-compose.yml      # Compose para dev
└── start.sh                # Script de inicializacao
```

## Rotas Principais

| Rota | Descricao |
|------|-----------|
| `/` | Landing page (portal publico) |
| `/login` | Tela de login |
| `/verificar-codigo` | Verificacao 2FA |
| `/selecionar-municipio` | Selecao de camara |
| `/dashboard` | Dashboard principal |
| `/vereadores` | Gestao de vereadores |
| `/partidos` | Gestao de partidos |
| `/legislaturas` | Gestao de legislaturas |
| `/sessoes` | Gestao de sessoes |
| `/admin/municipios` | Gestao de camaras (Super Admin) |

## API Endpoints

| Endpoint | Descricao |
|----------|-----------|
| `GET /api/health` | Health check |
| `GET /api/municipios` | Lista municipios |
| `GET /api/vereadores` | Lista vereadores |
| `GET /api/partidos` | Lista partidos |
| `GET /api/sessoes` | Lista sessoes |
| `GET /api/sessoes/atual` | Sessao em andamento |

## Autenticacao 2FA

1. Usuario faz login normalmente
2. Se 2FA ativo, codigo de 6 digitos e enviado por SMS
3. Usuario insere o codigo na tela de verificacao
4. Opcao de "Confiar neste dispositivo" por 30 dias

### Ativar 2FA para um usuario

1. Preencher campo `celular` do usuario
2. Definir `dois_fatores_ativo = true`

## Cores Dinamicas

Cada camara pode ter cores personalizadas:

- `cor_primaria`: Cor principal do tema
- `cor_secundaria`: Cor secundaria/gradiente

As cores sao aplicadas via CSS variables automaticamente.

## Changelog

### v1.0.0 (2024-12-30)
- Landing page (portal publico)
- Sistema de autenticacao com 2FA
- Multi-tenant com schemas separados
- Gestao de camaras, vereadores, partidos
- Gestao de sessoes e presencas
- Deploy Docker + Traefik

## Licenca

Proprietario - MDevelop / LhSystem
