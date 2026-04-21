// Endpoint de DEBUG — só usar durante testes
// POST /api/debug-notifications?secret=XXX&order_id=UUID
// Dispara manualmente as notificações pra um pedido já pago
import { supabaseAdmin } from '../lib/supabase.js';
import { fireAllNotifications, sendOwnerEmail, sendCustomerEmail, sendWhatsAppPedidos, sendWhatsAppEntregas, appendToSheet } from '../lib/notifications.js';

export default async function handler(req, res) {
  if (req.query.secret !== process.env.INFINITEPAY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ error: 'missing order_id' });

  // Testa cada notificação individualmente, captura erros separados
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !order) return res.status(404).json({ error: 'order not found', details: error?.message });

  const results = {};

  // Testa envs
  results.env_check = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    EMAILJS_SERVICE_OWNER: !!process.env.EMAILJS_SERVICE_OWNER,
    EMAILJS_TEMPLATE_OWNER: !!process.env.EMAILJS_TEMPLATE_OWNER,
    EMAILJS_SERVICE_CUSTOMER: !!process.env.EMAILJS_SERVICE_CUSTOMER,
    EMAILJS_TEMPLATE_CUSTOMER: !!process.env.EMAILJS_TEMPLATE_CUSTOMER,
    EMAILJS_PUBLIC_KEY: !!process.env.EMAILJS_PUBLIC_KEY,
    EMAILJS_PRIVATE_KEY: !!process.env.EMAILJS_PRIVATE_KEY,
    ZAPI_INSTANCE: !!process.env.ZAPI_INSTANCE,
    ZAPI_TOKEN: !!process.env.ZAPI_TOKEN,
    ZAPI_CLIENT_TOKEN: !!process.env.ZAPI_CLIENT_TOKEN,
    GROUP_PEDIDOS_ID: !!process.env.GROUP_PEDIDOS_ID,
    GROUP_ENTREGAS_ID: !!process.env.GROUP_ENTREGAS_ID,
  };

  const missingEnvs = Object.entries(results.env_check).filter(([, v]) => !v).map(([k]) => k);
  if (missingEnvs.length > 0) {
    results.env_missing = missingEnvs;
  }

  // Testa cada notificação
  const tasks = [
    ['owner_email', sendOwnerEmail],
    ['customer_email', sendCustomerEmail],
    ['whatsapp_pedidos', sendWhatsAppPedidos],
    ['whatsapp_entregas', sendWhatsAppEntregas],
    ['google_sheets', appendToSheet],
  ];

  for (const [name, fn] of tasks) {
    try {
      await fn(order);
      results[name] = 'OK';
    } catch (e) {
      results[name] = `FAIL: ${e.message}`;
    }
  }

  return res.status(200).json(results);
}
