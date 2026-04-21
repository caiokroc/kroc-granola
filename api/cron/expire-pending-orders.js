// Cron job — roda 1x/hora
// Marca como 'expired' pedidos pending com mais de 48h
// Autorizado via CRON_SECRET no header Authorization
import { supabaseAdmin } from '../../lib/supabase.js';

export default async function handler(req, res) {
  // Vercel Cron envia header Authorization: Bearer <CRON_SECRET>
  // Também aceita via query param secret= pra teste manual
  const auth = req.headers.authorization || '';
  const querySecret = req.query.secret;
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (auth !== expected && querySecret !== process.env.CRON_SECRET) {
    console.warn('[cron/expire] unauthorized attempt');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const TTL_HOURS = 48;
  const cutoff = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select('id, customer_name, total_amount, created_at');

    if (error) {
      console.error('[cron/expire] error:', error);
      return res.status(500).json({ error: error.message });
    }

    const count = data?.length || 0;
    console.log(`[cron/expire] ${count} orders expired (>${TTL_HOURS}h)`);
    if (count > 0) {
      console.log('[cron/expire] details:', data.map(o => `${o.id.slice(0,8)} (${o.customer_name}, R$${o.total_amount})`));
    }

    return res.status(200).json({
      success: true,
      expired: count,
      ttl_hours: TTL_HOURS,
      cutoff,
    });
  } catch (e) {
    console.error('[cron/expire] fatal:', e);
    return res.status(500).json({ error: e.message });
  }
}
