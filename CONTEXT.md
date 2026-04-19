# CONTEXT.md — Kroc Granola (Site)

> Arquivo de contexto pra Claude Code. Leia inteiro antes de começar qualquer tarefa.

## O que é este projeto

Site público da **Kroc Granola** — loja online de granola artesanal em São Paulo. Empresa: APP Indústria e Comércio Ltda. (ME, 3 sócios iguais: Caio, Leo, Felipe).

- **URL produção**: https://kroc-granola.vercel.app
- **Repo**: github.com/caiokroc/kroc-granola
- **Stack**: React 18 + Vite + Vercel (serverless functions em `/api/`)
- **Arquivo principal**: `src/App.jsx` (todo o site é um único arquivo, uns 440 linhas)

## Comandos essenciais

```bash
npm install        # instalar deps (uma vez)
npm run dev        # dev server em http://localhost:5173
npm run build      # build de produção
bash DEPLOY.sh     # deploy: força push main → Vercel builda em ~2min
```

**Importante**: `DEPLOY.sh` faz `rm -rf .git && git init && git add . && git commit -m "deploy" && git push --force origin main`. Ou seja, **apaga histórico**. Se precisar preservar histórico, fazer git manual (`git add/commit/push` sem o DEPLOY.sh).

## Arquitetura

### Fluxo de pedido

1. Cliente monta carrinho → aplica cupom (opcional) → preenche formulário
2. Clica "Ir para Pagamento"
3. **Antes de ir pro gateway**, o site dispara em paralelo:
   - `sendEmailData()` → EmailJS (email pro dono + pro cliente)
   - `sendToSheets()` → Google Sheets (legado, via `/api/sheets.js`)
   - `sendToSupabase()` → Supabase tabela `pedidos` (fonte de verdade)
   - `sendWhatsApp()` → Z-API (mensagem pros grupos PEDIDOS KROC + ENTREGAS KROC)
4. Se usou cupom: incrementa `uso_atual` em `cupons` e grava linha em `cupons_uso`
5. **Se total > 0**: chama `/api/checkout` que proxya pro InfinitiPay, redireciona pro link de pagamento
6. **Se total = 0** (cupom 100%): pula InfinitiPay, redireciona direto pra `/?payment=success&free=1`

### Integrações

| Serviço | Pra que | Config |
|---|---|---|
| **Supabase** | BD principal (pedidos, cupons, clientes) | Project `ownpsdvraqcnufjftjvk`, URL `https://ownpsdvraqcnufjftjvk.supabase.co`, Anon Key embutida no código |
| **InfinitiPay** | Gateway de pagamento | Handle `krocgranola`, chamada via proxy `/api/checkout.js` |
| **EmailJS** | Emails transacionais | Service `service_seg2uxg` (owner), `service_qygdida` (customer), public key `EU94wFheUNx3IA5v-` |
| **Z-API** | WhatsApp | Instance `3F0D1912EB86230EF548A609893209A0`, token `B342684DF915A4F6BDA35E78`, client-token `F4d697803a4b14b5d9170e716aaad4faaS`. Grupos: `120363410027685846-group` (PEDIDOS) e `120363407991521682-group` (ENTREGAS) |
| **Google Sheets** | Legado (backup) | Spreadsheet ID `11wQp3QNDbRV0hs4t12F3FYo2Q_0dJghfaZnHU6Rowqo`, via `/api/sheets.js` |

### Serverless functions (`/api/`)

- `checkout.js` — proxy pro InfinitiPay (CORS). Recebe payload do frontend, chama API.
- `sheets.js` — proxy pro Google Apps Script (CORS).
- `whatsapp.js` — proxy pro Z-API (precisa do header `Client-Token`).
- `webhook.js` — recebe callbacks do InfinitiPay.

## Modelo de dados (Supabase)

### Tabela `pedidos`
Campos: `pedido_num` (ex: P260417143021), `data`, `hora`, `cliente`, `email`, `telefone`, `qtd_40`, `qtd_240`, `qtd_500`, `subtotal`, `frete`, `total`, endereço completo, `metodo` (Pix/Crédito), `canal` (Online/Presencial), `producao`, `entrega`, `pagamento` (todos com valores "Pendente"/"Entregue"/"Pago"), `lote` (qual lote saiu, pode ser L005+L006 se múltiplos), `tipo` (Venda/Amostra), `custo`, `lucro`.

### Tabela `cupons`
Campos: `code`, `tipo` (percentual/fixo), `valor`, `validade`, `uso_maximo`, `uso_atual`, `escopo` (ex: "240g,500g,frete"), `ativo`, `limite_40/240/500`, `restricao_emails`, `restricao_telefones`, `uso_unico_por_cliente`.

### Tabela `cupons_uso`
Cada uso do cupom: `cupom_code`, `cliente`, `desconto_valor`, `created_at`, `cliente_email`, `cliente_telefone`.

### Trigger FIFO
Trigger `trg_aloca_fifo` na tabela `pedidos` (BEFORE INSERT): automaticamente aloca do lote mais antigo com estoque disponível, grava em `pedido_lotes`, e atualiza `NEW.lote` com os lotes usados (concatenados com `+`).

## Produtos

- **GRN-040** — Kroc Tradicional 40g (Mini) — R$ 9,90
- **GRN-240** — Kroc Tradicional 240g (Pequeno) — R$ 44,90
- **GRN-500** — Kroc Tradicional 500g (Médio) — R$ 84,90

## Frete

Só São Paulo capital. Origem: Rua Ministro Godoi 679, Água Branca.
- ≤3km: R$ 5
- ≤5km: R$ 10
- >5km: R$ 15

## Cupons — lógica de aplicação

Quando cliente aplica cupom, o código faz:

1. Busca em `cupons` pelo `code` (case-insensitive)
2. Valida: ativo, dentro da validade, `uso_atual < uso_maximo`
3. Se `restricao_emails` preenchido: email do cliente precisa estar na lista (lowercase, trim)
4. Se `restricao_telefones` preenchido: só dígitos do telefone precisa estar na lista
5. Se `uso_unico_por_cliente=true`: consulta `cupons_uso` e bloqueia se email/telefone já usou esse código
6. Calcula desconto **só sobre os itens dentro do `escopo`**
7. Se `limite_40/240/500` definido: aplica desconto apenas nas N primeiras unidades daquele produto, resto vai preço cheio

### Fix importante do checkout

Quando tem cupom, o payload pro InfinitiPay **não pode mandar items individuais** (ela valida preços contra catálogo do handle `krocgranola` e rejeita qualquer preço modificado). Solução: mandar UM item consolidado com o valor total já descontado:

```js
if (couponDisc > 0) {
  items = [{
    quantity: 1,
    price: Math.round(tot * 100), // total em centavos
    description: "Pedido Kroc — " + summary + " (Cupom XXX -Y%)"
  }];
}
```

Quando **não tem cupom**, envia items individuais normalmente (preços batem com catálogo).

Quando `tot <= 0` (cupom 100%), pula InfinitiPay completamente e redireciona direto pra `/?payment=success&free=1`.

## Estado atual do projeto

- ✅ Bug do cupom 100% **corrigido** (pula InfinitiPay quando tot=0)
- ✅ Sistema de cupons com `escopo` e `uso_maximo` funcionando
- 🚧 **PRÓXIMA FEATURE**: expandir cupons com restrições avançadas — limite de unidades por produto, restrição por email/telefone, uso único por cliente. Ver seção "Próxima tarefa" abaixo.

## Próxima tarefa

**Expandir sistema de cupons** com 3 novas restrições (colunas já existem na tabela `cupons`):

1. **Limite de unidades com desconto**: `limite_40`, `limite_240`, `limite_500` (INTEGER, nullable). Se preenchido, desconto aplica só nas N primeiras unidades do produto; o resto vai preço cheio.
   - Exemplo: cupom 100% no 240g com `limite_240=1`, pedido de 3 unidades → 1 grátis + 2 × R$44,90 = R$89,80

2. **Restrição por cliente**: `restricao_emails` e `restricao_telefones` (TEXT, lista separada por vírgula). Se preenchido, o cliente só consegue aplicar o cupom se seu email OU telefone estiver na lista.
   - Normalizar: email lowercase/trim, telefone só dígitos
   - Se ambas preenchidas: qualquer uma autoriza (OR, não AND)
   - Se cliente ainda não preencheu dados no formulário, permite aplicar mas re-valida no checkout

3. **Uso único por cliente**: `uso_unico_por_cliente` (BOOLEAN). Se true, cada cliente (identificado por email OU telefone) só pode usar 1x. Consultar `cupons_uso` (campos `cliente_email` e `cliente_telefone`) antes de aprovar.

### Mudanças necessárias no código do site

- Função `applyCoupon` / cálculo de desconto no `App.jsx`:
  - Buscar os novos campos ao carregar o cupom
  - Adicionar validação de cliente (email/telefone)
  - Adicionar validação de uso único (consultar `cupons_uso`)
  - Implementar cálculo proporcional do desconto quando há limite de unidades
- Mensagens de erro claras:
  - "Este cupom é exclusivo. Preencha email/telefone autorizado para continuar."
  - "Você já usou este cupom anteriormente."
- Ao gravar em `cupons_uso` no final do checkout, incluir `cliente_email` e `cliente_telefone`

### SQL auxiliar (se necessário)

```sql
ALTER TABLE cupons_uso ADD COLUMN IF NOT EXISTS cliente_email TEXT;
ALTER TABLE cupons_uso ADD COLUMN IF NOT EXISTS cliente_telefone TEXT;
CREATE INDEX IF NOT EXISTS idx_cupons_uso_email ON cupons_uso(cliente_email);
CREATE INDEX IF NOT EXISTS idx_cupons_uso_telefone ON cupons_uso(cliente_telefone);
```

## Projeto irmão

Existe em paralelo o **kroc-admin** (painel administrativo) em `github.com/caiokroc/kroc-admin`, que gerencia cupons, pedidos, estoque, etc. Lê/escreve nas mesmas tabelas do Supabase. A UI de criar/editar cupons com essas novas restrições vai ser feita lá.

## Sobre o desenvolvedor

Caio não é dev de formação. Prefere **explicações de root cause** sobre tentativa-e-erro. Valoriza soluções que preservam dados/histórico. Quando algo quebra, prefere diagnóstico antes de "tentar coisas".

## Convenções

- Não criar arquivos novos desnecessariamente — tudo cabe no `App.jsx`
- Estilos inline com objetos JS (sem CSS separado)
- Variáveis de cor/paleta já definidas no topo do arquivo (`X.acc`, `X.mut`, etc)
- Componentes reutilizáveis já existem: `<Inp>`, `<Sel>`, `<Btn>`, `<Modal>` — usar em vez de re-criar
- Console.log com prefixo `[Checkout]`, `[Supabase]`, etc pra facilitar debug
