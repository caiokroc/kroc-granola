// Cria pedido pending no Supabase ANTES de chamar a InfinitiPay
// Retorna URL de checkout pro frontend redirecionar
import { supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      items,
      qty_40 = 0,
      qty_240 = 0,
      qty_500 = 0,
      subtotal = 0,
      frete = 0,
      desconto = 0,
      total_amount,
      cupom_code,
      cupom_desconto_pct,
    } = req.body || {};

    if (!customer_name || !customer_email || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Dados do pedido incompletos' });
    }

    // 1) Grava pending ANTES de tudo
    const { data: order, error: insErr } = await supabaseAdmin
      .from('orders')
      .insert({
        status: 'pending',
        customer_name,
        customer_email: (customer_email || '').toLowerCase().trim(),
        customer_phone,
        customer_address,
        items,
        qty_40, qty_240, qty_500,
        subtotal, frete, desconto,
        total_amount,
        cupom_code: cupom_code || null,
        cupom_desconto_pct: cupom_desconto_pct || null,
      })
      .select()
      .single();

    if (insErr) {
      console.error('[checkout] insert error', insErr);
      return res.status(500).json({ error: 'Falha ao criar pedido', details: insErr.message });
    }

    const orderId = order.id;
    const BASE = process.env.PUBLIC_SITE_URL || 'https://kroc-granola.vercel.app';
    const WEBHOOK_SECRET = process.env.INFINITEPAY_WEBHOOK_SECRET;
    const webhookUrl = `${BASE}/api/webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`;
    const redirectUrl = `${BASE}/obrigado?order_id=${orderId}`;

    // 2) Formata items pra InfinitiPay (preços em centavos)
    //    Consolida em 1 item se tiver cupom (workaround pro bug de validação de catálogo)
    let ipItems;
    if (cupom_code && desconto > 0) {
      ipItems = [{
        quantity: 1,
        price: Math.round(Number(total_amount) * 100),
        description: `Pedido Kroc (${[qty_40&&`${qty_40}x 40g`,qty_240&&`${qty_240}x 240g`,qty_500&&`${qty_500}x 500g`].filter(Boolean).join(' + ')}) cupom ${cupom_code}`,
      }];
    } else {
      ipItems = [];
      if (qty_40 > 0) ipItems.push({ quantity: qty_40, price: 990, description: 'Kroc Granola 40g' });
      if (qty_240 > 0) ipItems.push({ quantity: qty_240, price: 4490, description: 'Kroc Granola 240g' });
      if (qty_500 > 0) ipItems.push({ quantity: qty_500, price: 8490, description: 'Kroc Granola 500g' });
      if (frete > 0) ipItems.push({ quantity: 1, price: Math.round(frete * 100), description: 'Frete' });
    }

    const payload = {
      handle: process.env.INFINITEPAY_HANDLE,
      redirect_url: redirectUrl,
      webhook_url: webhookUrl,
      order_nsu: orderId,
      customer: {
        name: customer_name,
        email: customer_email,
        phone_number: customer_phone ? ('+55' + String(customer_phone).replace(/\D/g, '').slice(-11)) : undefined,
      },
      items: ipItems,
    };

    const ipRes = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ipData = await ipRes.json().catch(() => ({}));

    if (!ipRes.ok) {
      console.error('[checkout] InfinitiPay error', ipRes.status, ipData);
      await supabaseAdmin
        .from('orders')
        .update({ status: 'failed', raw_webhook_payload: { infinitepay_error: ipData } })
        .eq('id', orderId);
      return res.status(502).json({ error: 'Falha ao gerar checkout', details: ipData });
    }

    const checkoutUrl = ipData.url || ipData.checkout_url || ipData.link;
    // Extrai id/slug: tenta campos diretos primeiro, depois extrai do URL (parâmetro lenc=)
    let checkoutId = ipData.slug || ipData.invoice_slug || ipData.id || null;
    if (!checkoutId && checkoutUrl) {
      try {
        const u = new URL(checkoutUrl);
        checkoutId = u.searchParams.get('lenc') || u.pathname.split('/').pop() || null;
      } catch {}
    }

    console.log('[checkout] InfinitiPay response:', { checkoutId: checkoutId?.slice(0, 30), checkoutUrl: checkoutUrl?.slice(0, 60) });

    await supabaseAdmin
      .from('orders')
      .update({
        infinitepay_checkout_id: checkoutId,
        infinitepay_checkout_url: checkoutUrl,
      })
      .eq('id', orderId);

    return res.status(200).json({
      success: true,
      order_id: orderId,
      checkout_url: checkoutUrl,
    });
  } catch (e) {
    console.error('[checkout] fatal', e);
    return res.status(500).json({ error: 'Erro interno', details: e.message });
  }
}
