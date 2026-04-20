// Recebe webhook da InfinitiPay quando pagamento é confirmado
// Valida autenticidade (secret + payment_check), marca order como paid, dispara notificações
import { supabaseAdmin } from '../lib/supabase.js';
import { fireAllNotifications } from '../lib/notifications.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 1) Autenticidade: secret na URL
  if (req.query.secret !== process.env.INFINITEPAY_WEBHOOK_SECRET) {
    console.warn('[webhook] invalid secret', {
      got: (req.query.secret || '').slice(0, 8) + '...',
    });
    return res.status(401).json({ error: 'unauthorized' });
  }

  const payload = req.body || {};
  const {
    invoice_slug,
    transaction_nsu,
    order_nsu,
    paid_amount,
    amount,
    installments,
    capture_method,
    receipt_url,
  } = payload;

  const orderId = order_nsu;
  const eventId = transaction_nsu || `${invoice_slug}:${order_nsu}`;

  console.log('[webhook] received', { orderId, eventId, capture_method });

  if (!orderId || !eventId) {
    console.error('[webhook] missing ids', payload);
    return res.status(200).json({ success: false, message: 'invalid payload' });
  }

  // 2) Idempotência: UNIQUE event_id bloqueia duplicados
  const { error: evErr } = await supabaseAdmin
    .from('webhook_events')
    .insert({ event_id: eventId, order_id: orderId, payload });

  if (evErr?.code === '23505') {
    console.log('[webhook] duplicate, already processed:', eventId);
    return res.status(200).json({ success: true, duplicate: true });
  }
  if (evErr) {
    console.error('[webhook] db error', evErr);
    // 400 → InfinitiPay retenta
    return res.status(400).json({ success: false, message: 'db error' });
  }

  // 3) Busca o pedido
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (!order) {
    console.error('[webhook] order not found', orderId);
    return res.status(400).json({ success: false, message: 'Pedido não encontrado' });
  }

  // 4) Double-check: confirma na InfinitiPay que pagou mesmo
  let paidConfirmed = true;
  try {
    const checkRes = await fetch(
      'https://api.infinitepay.io/invoices/public/checkout/payment_check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: process.env.INFINITEPAY_HANDLE,
          order_nsu: orderId,
          transaction_nsu,
          slug: invoice_slug,
        }),
      }
    );
    const checkData = await checkRes.json().catch(() => ({}));
    paidConfirmed = checkData?.success === true && checkData?.paid === true;
    if (!paidConfirmed) {
      console.warn('[webhook] payment_check says not paid:', checkData);
    }
  } catch (e) {
    console.warn('[webhook] payment_check network fail, trusting secret:', e.message);
    paidConfirmed = true;
  }

  if (!paidConfirmed) {
    await supabaseAdmin
      .from('webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error: 'payment_check_failed',
      })
      .eq('event_id', eventId);
    return res.status(200).json({ success: true, paid: false });
  }

  // 5) Promove pending → paid (guard: só se ainda for pending)
  if (order.status !== 'paid') {
    await supabaseAdmin
      .from('orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        infinitepay_transaction_nsu: transaction_nsu,
        payment_method: capture_method || order.payment_method || 'infinitepay',
        raw_webhook_payload: payload,
      })
      .eq('id', orderId)
      .eq('status', 'pending');
  }

  // 6) Responde 200 rápido (InfinitiPay exige <1s)
  res.status(200).json({ success: true, message: null });

  // 7) Notificações em background
  try {
    const { data: fresh } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fresh && fresh.status === 'paid' && !fresh.notifications_sent) {
      const anyOk = await fireAllNotifications(fresh);
      if (anyOk) {
        await supabaseAdmin
          .from('orders')
          .update({ notifications_sent: true })
          .eq('id', orderId);
      }
    }

    await supabaseAdmin
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', eventId);
  } catch (e) {
    console.error('[webhook] bg notif error', e);
    await supabaseAdmin
      .from('webhook_events')
      .update({ processed: false, error: String(e?.message || e) })
      .eq('event_id', eventId);
  }
}
