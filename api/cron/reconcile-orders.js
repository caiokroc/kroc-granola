// Cron job — roda a cada 15min
// Pega pending com idade 10min-2h e consulta a InfinitiPay
// Se InfinitiPay confirma que pagou, promove para paid → trigger migra → notifica
// 
// Isso é o SAFETY NET caso o webhook da InfinitiPay falhe por qualquer motivo:
// - Timeout na entrega
// - Erro na resposta nossa (400)
// - InfinitiPay bloqueada temporariamente
// - Qualquer edge case
//
// NÃO atinge pedidos muito recentes (dá tempo do webhook chegar primeiro)
// NÃO atinge pedidos muito antigos (seriam marcados como 'expired' pelo outro cron)
import { supabaseAdmin } from '../../lib/supabase.js';
import { fireAllNotifications } from '../../lib/notifications.js';

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const querySecret = req.query.secret;
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (auth !== expected && querySecret !== process.env.CRON_SECRET) {
    console.warn('[cron/reconcile] unauthorized attempt');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const now = Date.now();
  const MIN_AGE = 10 * 60 * 1000;  // não bulina com pedidos <10min (webhook ainda pode chegar)
  const MAX_AGE = 2 * 60 * 60 * 1000; // 2h — depois disso vira 'expired' pelo outro cron

  const minAgeIso = new Date(now - MIN_AGE).toISOString();
  const maxAgeIso = new Date(now - MAX_AGE).toISOString();

  try {
    // Busca pedidos pending na janela 10min - 2h
    const { data: pendings, error: queryErr } = await supabaseAdmin
      .from('orders')
      .select('id, customer_name, total_amount, infinitepay_checkout_id, created_at')
      .eq('status', 'pending')
      .lt('created_at', minAgeIso)
      .gt('created_at', maxAgeIso)
      .not('infinitepay_checkout_id', 'is', null);

    if (queryErr) {
      console.error('[cron/reconcile] query err:', queryErr);
      return res.status(500).json({ error: queryErr.message });
    }

    const total = pendings?.length || 0;
    console.log(`[cron/reconcile] checking ${total} pending orders`);

    if (total === 0) {
      return res.status(200).json({ checked: 0, results: [] });
    }

    const results = [];
    for (const o of pendings) {
      try {
        // Consulta a InfinitiPay se esse pedido foi pago
        const checkRes = await fetch(
          'https://api.infinitepay.io/invoices/public/checkout/payment_check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              handle: process.env.INFINITEPAY_HANDLE,
              order_nsu: o.id,
              slug: o.infinitepay_checkout_id,
            }),
          }
        );
        const checkData = await checkRes.json().catch(() => ({}));

        if (checkData?.success && checkData?.paid) {
          // Pagou! Promove pra paid — trigger do banco migra pra pedidos
          console.log(`[cron/reconcile] FOUND PAID: ${o.id} (${o.customer_name}) — promoting`);

          const { error: updErr } = await supabaseAdmin
            .from('orders')
            .update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              payment_method: checkData.capture_method || 'infinitepay',
              raw_webhook_payload: { reconciled: true, check: checkData, at: new Date().toISOString() },
            })
            .eq('id', o.id)
            .eq('status', 'pending');

          if (updErr) {
            console.error(`[cron/reconcile] update err for ${o.id}:`, updErr);
            results.push({ id: o.id, status: 'update_failed', error: updErr.message });
            continue;
          }

          // Busca fresh pra notificar
          const { data: fresh } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('id', o.id)
            .single();

          if (fresh && !fresh.notifications_sent) {
            console.log(`[cron/reconcile] firing notifications for ${o.id}`);
            try {
              const anyOk = await fireAllNotifications(fresh);
              if (anyOk) {
                await supabaseAdmin
                  .from('orders')
                  .update({ notifications_sent: true })
                  .eq('id', o.id);
              }
              results.push({ id: o.id, status: 'paid_notified', notif_ok: anyOk });
            } catch (notifErr) {
              console.error(`[cron/reconcile] notif err:`, notifErr);
              results.push({ id: o.id, status: 'paid_notif_failed', error: notifErr.message });
            }
          } else {
            results.push({ id: o.id, status: 'paid_already_notified' });
          }
        } else {
          results.push({ id: o.id, status: 'not_paid_yet' });
        }
      } catch (e) {
        console.error(`[cron/reconcile] error checking ${o.id}:`, e);
        results.push({ id: o.id, status: 'error', error: e.message });
      }
    }

    const reconciled = results.filter(r => r.status === 'paid_notified' || r.status === 'paid_already_notified').length;
    console.log(`[cron/reconcile] done — checked ${total}, reconciled ${reconciled}`);

    return res.status(200).json({
      checked: total,
      reconciled,
      results,
    });
  } catch (e) {
    console.error('[cron/reconcile] fatal:', e);
    return res.status(500).json({ error: e.message });
  }
}
