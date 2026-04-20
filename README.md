# FASE 3 — Frontend + Teste End-to-End

## O que muda

### App.jsx (site)
- ❌ **Removido**: chamadas a `sendEmailData`, `sendToSheets`, `sendToSupabase`, `sendWhatsApp` no clique "Ir para Pagamento"
- ✅ **Agora**: uma única chamada pra `/api/checkout` → redireciona pra InfinitiPay
- ✅ **Nova tela** `awaiting_payment` com polling a cada 3s via `/api/order-status`
- ✅ **3 estados visuais**: aguardando (⏳) → pago (✓) ou timeout (⏱) ou falha (✕)
- ✅ **Fast-path pedido gratuito** (cupom 100%) grava direto como paid

### checkout.js (API)
- 🔧 **Correção**: extrai `lenc` do URL se slug não vier na resposta (o que causou `infinitepay_checkout_id: NULL` no teste anterior)

## Como aplicar

### 1. Copia os arquivos

```bash
cp ~/Downloads/fase3/App.jsx ~/Desktop/Kroc/kroc-granola/src/App.jsx
cp ~/Downloads/fase3/checkout.js ~/Desktop/Kroc/kroc-granola/api/checkout.js
```

### 2. Commit e push na branch

```bash
cd ~/Desktop/Kroc/kroc-granola
git add -A
git status
git commit -m "fase 3: frontend polling + fix checkout slug extraction"
git push origin webhook-pagamento
```

Vercel vai gerar novo preview em ~2 min.

### 3. Testa no preview

Abre a URL do preview (a mesma da Fase 2):
`https://kroc-granola-git-webhook-pagamento-caio-5910s-projects.vercel.app`

Faz um pedido completo:
1. Clica num produto (Kroc 240g, R$ 44,90)
2. Preenche teu endereço real
3. Clica "Ir para Pagamento"

**O que deve acontecer:**
- Você é redirecionado pra `checkout.infinitepay.io/krocgranola?lenc=...`
- **Nada ainda é notificado** (sem email, sem WhatsApp)

**Escolha A — ABANDONE (teste de pedido fantasma):**
- Fecha a aba da InfinitiPay sem pagar
- Vai no Supabase e roda: `select * from orders order by created_at desc limit 1`
- Status = `pending`, sem email/WhatsApp — ✅ correto!

**Escolha B — PAGA DE VERDADE com R$ 1:**
- Pra isso precisa de produto com preço R$ 1 no site (pra teste). Não precisa — paga o valor real mesmo, R$ 44,90
- Paga via PIX (mais rápido pra testar)
- Você é redirecionado pra `/obrigado?order_id=XXX`
- A tela mostra "Aguardando confirmação…" com ⏳
- Em 3-10s, o webhook da InfinitiPay chega e a tela vira "Pagamento Confirmado!" com ✓
- **Você recebe email + WhatsApp pedidos + WhatsApp entregas + Google Sheets**

## Testes de validação

### Antes de qualquer pagamento real
```bash
PREVIEW_URL="https://kroc-granola-git-webhook-pagamento-caio-5910s-projects.vercel.app"

# Site carrega?
curl -s -o /dev/null -w "%{http_code}\n" $PREVIEW_URL/
# Esperado: 200

# Página /obrigado com order_id inválido ainda carrega?
curl -s -o /dev/null -w "%{http_code}\n" "$PREVIEW_URL/obrigado?order_id=abc"
# Esperado: 200 (SPA — o /obrigado é handler do React, não rota física)
```

### Depois do pedido teste

**No Supabase:**
```sql
select id, status, customer_name, total_amount, infinitepay_checkout_id, 
       payment_method, paid_at, notifications_sent, created_at
from public.orders
order by created_at desc
limit 5;
```

Pedidos recentes devem ter:
- `infinitepay_checkout_id` NÃO NULL (agora corrigido)
- Se abandonou: `status='pending'`, `paid_at=null`
- Se pagou: `status='paid'`, `paid_at=timestamp`, `notifications_sent=true`, `payment_method='pix'` ou `'credit_card'`

**Tabela webhook_events:**
```sql
select event_id, order_id, processed, error, received_at
from public.webhook_events
order by received_at desc
limit 5;
```

Se pagou: deve ter 1 linha com `processed=true`, `error=null`.

**Logs do Vercel:**
- Vai em Vercel Dashboard → kroc-granola → Deployments → último → Logs
- Procura por `[webhook]` e `[notif]`
- Deve ver: `[webhook] received`, `[notif] owner_email OK`, `[notif] customer_email OK`, etc

## Se algo der errado

### Tela "Aguardando confirmação" nunca muda pra "Pago"
- InfinitiPay não chamou o webhook
- Logs Vercel mostram se o webhook chegou
- Após 3 min, aparece "Pagamento em processamento" com opção de WhatsApp
- O polling então tenta `payment_check` automaticamente (fallback)

### Webhook chegou mas notificações não dispararam
- Confere no Supabase: `select notifications_sent from orders where ...`
- Se `notifications_sent=false` e `status=paid`: problema em `/lib/notifications.js`
- Logs Vercel mostram qual notification falhou (ex: `[notif] whatsapp_pedidos FAILED: ...`)

### Erro "module not found @supabase/supabase-js"
- Roda `npm install @supabase/supabase-js` de novo
- Commit o `package.json` atualizado: `git add package.json package-lock.json && git commit -m "deps"`

### Erro de CORS/hydration no site
- O App.jsx tem `setPollingOrderId` referenciado mas declarado depois — React permite. Se der erro, me avisa.

## Próximos passos (Fase 4)

Depois que tudo funcionar:
- Cron que expira pendings com >24h
- Cron de reconciliação a cada 15 min (caso webhook falhe)
- Admin mostrar `orders pending` separado de `pedidos pagos`
- Migração automática: quando `orders.status='paid'`, cria linha em `pedidos` com FIFO

## IMPORTANTE: ainda NÃO fizer merge pra main

Só faz merge pra main (produção) depois da Fase 4 completa. O preview é suficiente pra testar todo o fluxo agora.
