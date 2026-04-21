// Endpoint de consulta — o frontend pergunta "meu pedido já foi pago?"
// Com fallback: se passou 2min e ainda pending, consulta InfinitiPay ativamente
import { supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'missing id' });

  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, status, paid_at, created_at, infinitepay_checkout_id, total_amount, customer_name')
    .eq('id', id)
    .single();

  if (error || !order) return res.status(404).json({ error: 'not found' });

  // Fallback: se ainda pending e passou >2min, consulta a InfinitiPay
  const ageMs = Date.now() - new Date(order.created_at).getTime();
  if (order.status === 'pending' && ageMs > 2 * 60 * 1000 && order.infinitepay_checkout_id) {
    try {
      const r = await fetch(
        'https://api.infinitepay.io/invoices/public/checkout/payment_check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle: process.env.INFINITEPAY_HANDLE,
            order_nsu: id,
            slug: order.infinitepay_checkout_id,
          }),
        }
      );
      const d = await r.json().catch(() => ({}));
      if (d?.success && d?.paid) {
        await supabaseAdmin
          .from('orders')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'pending');
        return res.status(200).json({
          status: 'paid',
          paid_at: new Date().toISOString(),
          customer_name: order.customer_name,
        });
      }
    } catch (e) {
      console.warn('[order-status] fallback fail', e.message);
    }
  }

  return res.status(200).json({
    status: order.status,
    paid_at: order.paid_at,
    customer_name: order.customer_name,
  });
}
