# Gestor de Horários — ESEUC

Aplicação de planeamento de horários da **Escola Superior de Enfermagem da Universidade de Coimbra**.

- **Frontend**: React + Vite + TailwindCSS.
- **Motor de distribuição**: TypeScript, 100% no cliente (`src/utils/distribuicao.ts`) — gera o horário das 30 semanas com as regras pedagógicas (T→TP→PL, máx. 6 PL por mancha, sem conflitos de turma, calendário/feriados, almoço).
- **Base de dados**: Supabase (PostgreSQL) com Row Level Security.
- **Autenticação**: Supabase Auth — acesso institucional `@ese.uc.pt`, só por convite (admins).
- **IA**: assistente Gemini via endpoint Express (`/api/gemini/chat`).

## Desenvolvimento

```bash
npm install
cp .env.example .env   # preencher credenciais Supabase
npm run dev            # http://localhost:3000
```

## Variáveis de ambiente

Cliente (embebidas no build, públicas):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Servidor (secretas, nunca no cliente):
- `SUPABASE_SERVICE_ROLE_KEY` — criar utilizadores convidados
- `GEMINI_API_KEY` — assistente IA

## Base de dados (Supabase)

Correr no SQL Editor, por ordem: `supabase/schema.sql`, `supabase/auth_profiles.sql`,
`supabase/migracao_semanas_e_regras.sql`.

## Deploy (Netlify)

`netlify.toml` configura o build estático. Definir `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` nas variáveis de ambiente do site.

> Os endpoints `/api/*` (Express) não correm em hosting estático — ficam para
> Netlify Functions num passo seguinte.
