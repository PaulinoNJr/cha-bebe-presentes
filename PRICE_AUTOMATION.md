# Automacao de Precos (Fila)

Este projeto agora suporta:
- fila de atualizacao de precos no Supabase
- agendamento por intervalo (`1h`, `2h`, `3h`, `6h`, `12h`, `1x ao dia`, `2 dias`, ou manual)
- processamento manual no `admin.html` (botao `Processar fila no navegador`)

Obs.: o backend aceita qualquer periodicidade a partir de `60` minutos.

## Passo 1: atualizar banco

Execute o `supabase-setup.sql` mais recente no SQL Editor.

## Passo 2: configurar no admin

Na tela `admin.html`:
1. Em **Atualizacao de precos em lote (fila)**, escolha o agendamento.
2. Clique em `Salvar agendamento`.
3. Opcional: clique em `Enfileirar todos agora`.

## Passo 3: processador externo (recomendado)

Use o worker `scripts/price-worker.mjs`.

Variaveis de ambiente:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- opcional: `PRICE_WORKER_BATCH_SIZE` (padrao `20`)
- opcional: `PRICE_WORKER_MAX_BATCHES` (padrao `5`)
- opcional: `PRICE_WORKER_FORCE_ENQUEUE_ALL=true` (enfileira todos os itens em cada execucao)

Importante:
- `SUPABASE_SERVICE_ROLE_KEY` precisa ser a chave de **Service Role** do projeto Supabase.
- Se usar `anonKey`, o worker falha com `NOT_ADMIN`.

Execucao:

```bash
node scripts/price-worker.mjs
```

## Opcoes de execucao externa

1. **GitHub Actions (cron)**: mais simples para rodar de hora em hora ou diario.
2. **Task Scheduler (Windows)**: roda localmente em horario fixo.
3. **Servidor/VPS com cron**: controle total.

Exemplos de cron:
- a cada 1 hora: `0 * * * *`
- 1 vez ao dia (03:00): `0 3 * * *`
- a cada 6 horas: `0 */6 * * *`
