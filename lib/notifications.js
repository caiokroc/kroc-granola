// Centraliza todas as notificações (email, whatsapp, sheets)
// Só é chamado quando o webhook confirma pagamento

const fmtBRL = (v) =>
  'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

// ═══ EmailJS server-side (REST direto, sem SDK) ═══
async function emailjsSend(serviceId, templateId, params) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: params,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`EmailJS ${res.status}: ${err.slice(0, 200)}`);
  }
  return true;
}

function buildEmailParams(order) {
  const addr = order.customer_address || {};
  const itemsArr = [];
  if (order.qty_40 > 0) itemsArr.push(`${order.qty_40}x Kroc 40g`);
  if (order.qty_240 > 0) itemsArr.push(`${order.qty_240}x Kroc 240g`);
  if (order.qty_500 > 0) itemsArr.push(`${order.qty_500}x Kroc 500g`);

  return {
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_phone: order.customer_phone || '',
    order_id: (order.pedido_id || order.id.slice(0, 8)),
    order_details: itemsArr.join(' + ') +
      (order.cupom_code ? `\nCupom: ${order.cupom_code} (-${order.cupom_desconto_pct || 0}%)` : '') +
      `\nFrete: ${fmtBRL(order.frete || 0)}`,
    order_total: fmtBRL(order.total_amount),
    subtotal: fmtBRL(order.subtotal || 0),
    frete: fmtBRL(order.frete || 0),
    total: fmtBRL(order.total_amount),
    delivery_address: [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city]
      .filter(Boolean).join(', '),
    endereco: [addr.street, addr.number].filter(Boolean).join(', ') +
              (addr.neighborhood ? ' - ' + addr.neighborhood : ''),
    order_date: new Date(order.paid_at || Date.now())
      .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    date: new Date(order.paid_at || Date.now())
      .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    payment_method: order.payment_method || 'Pagamento confirmado',
  };
}

export async function sendOwnerEmail(order) {
  return emailjsSend(
    process.env.EMAILJS_SERVICE_OWNER,
    process.env.EMAILJS_TEMPLATE_OWNER,
    buildEmailParams(order)
  );
}

export async function sendCustomerEmail(order) {
  return emailjsSend(
    process.env.EMAILJS_SERVICE_CUSTOMER,
    process.env.EMAILJS_TEMPLATE_CUSTOMER,
    buildEmailParams(order)
  );
}

// ═══ Z-API WhatsApp ═══
async function zapiSendText(phone, message) {
  const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({ phone, message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Z-API ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export async function sendWhatsAppPedidos(order) {
  const addr = order.customer_address || {};
  const itemsArr = [];
  if (order.qty_40 > 0) itemsArr.push(`${order.qty_40}x Kroc 40g`);
  if (order.qty_240 > 0) itemsArr.push(`${order.qty_240}x Kroc 240g`);
  if (order.qty_500 > 0) itemsArr.push(`${order.qty_500}x Kroc 500g`);

  let msg = `🥣 NOVO PEDIDO KROC ✅ PAGO\n\n`;
  msg += `👤 ${order.customer_name}\n`;
  msg += `📱 ${order.customer_phone || '-'}\n`;
  if (order.customer_email) msg += `📧 ${order.customer_email}\n`;
  msg += `\n📦 ${itemsArr.join(' + ')}\n`;
  msg += `\n💰 Subtotal: ${fmtBRL(order.subtotal || 0)}\n`;
  if (order.cupom_code) {
    msg += `🎟️ Cupom ${order.cupom_code} (-${order.cupom_desconto_pct || 0}%): -${fmtBRL(order.desconto || 0)}\n`;
  }
  msg += `🛵 Frete: ${fmtBRL(order.frete || 0)}\n`;
  msg += `💵 Total: ${fmtBRL(order.total_amount)}\n`;
  msg += `💳 Via: ${order.payment_method || 'InfinitiPay'}`;

  return zapiSendText(process.env.GROUP_PEDIDOS_ID, msg);
}

export async function sendWhatsAppEntregas(order) {
  const addr = order.customer_address || {};
  const itemsArr = [];
  if (order.qty_40 > 0) itemsArr.push(`${order.qty_40}x 40g`);
  if (order.qty_240 > 0) itemsArr.push(`${order.qty_240}x 240g`);
  if (order.qty_500 > 0) itemsArr.push(`${order.qty_500}x 500g`);

  let msg = `🛵 NOVA ENTREGA KROC\n\n`;
  msg += `👤 ${order.customer_name}\n`;
  msg += `📱 ${order.customer_phone || '-'}\n\n`;
  msg += `📍 ${addr.street || ''}, ${addr.number || ''}`;
  if (addr.complement) msg += ` - ${addr.complement}`;
  msg += `\n${addr.neighborhood || ''} - ${addr.city || ''}/${addr.state || ''}\n`;
  msg += `CEP: ${addr.cep || ''}\n\n`;
  msg += `📦 ${itemsArr.join(' + ')}\n`;
  if (order.cupom_code) msg += `🎟️ ${order.cupom_code}\n`;
  msg += `💵 ${fmtBRL(order.total_amount)}`;

  return zapiSendText(process.env.GROUP_ENTREGAS_ID, msg);
}

// ═══ Google Sheets ═══
export async function appendToSheet(order) {
  // Usa o endpoint /api/sheets.js existente (proxy pro Apps Script)
  // Apps Script espera formato específico — NÃO mudar nomes de campos
  const base = process.env.PUBLIC_SITE_URL || 'https://kroc-granola.vercel.app';
  const addr = order.customer_address || {};
  const couponCode = order.cupom_code || '-';
  const couponPct = order.cupom_desconto_pct || 0;
  const discountVal = Number(order.desconto || 0);
  const payload = {
    name: order.customer_name || '',
    phone: order.customer_phone || '',
    email: order.customer_email || '',
    qty240: order.qty_240 || 0,
    qty500: order.qty_500 || 0,
    frete: Number(order.frete || 0),
    subtotal: Number(order.subtotal || 0),
    couponCode,
    discountPct: couponPct,
    discountVal,
    total: Number(order.total_amount || 0),
    rua: addr.street || '',
    numero: addr.number || '',
    complemento: addr.complement || '',
    bairro: addr.neighborhood || '',
    cidade: addr.city || 'São Paulo',
    estado: addr.state || 'SP',
    cep: addr.cep || '',
    metodo: order.payment_method === 'pix' ? 'Pix'
      : order.payment_method === 'credit_card' ? 'Crédito'
      : order.payment_method === 'apple_pay' ? 'Apple Pay'
      : order.payment_method === 'free_coupon' ? 'Cupom 100%'
      : (order.payment_method || 'Site'),
  };
  const res = await fetch(`${base}/api/sheets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}`);
  return true;
}

// ═══ Orquestrador — chama tudo em paralelo, tolera falhas parciais ═══
export async function fireAllNotifications(order) {
  const tasks = [
    ['owner_email', () => sendOwnerEmail(order)],
    ['customer_email', () => sendCustomerEmail(order)],
    ['whatsapp_pedidos', () => sendWhatsAppPedidos(order)],
    ['whatsapp_entregas', () => sendWhatsAppEntregas(order)],
    ['google_sheets', () => appendToSheet(order)],
  ];

  const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  results.forEach((r, i) => {
    const [name] = tasks[i];
    if (r.status === 'rejected') {
      console.error(`[notif] ${name} FAILED:`, r.reason?.message || r.reason);
    } else {
      console.log(`[notif] ${name} OK`);
    }
  });

  // retorna true se ao menos 1 deu certo
  return results.some((r) => r.status === 'fulfilled');
}
