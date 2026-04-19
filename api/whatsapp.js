const ZAPI_INSTANCE = "3F0D1912EB86230EF548A609893209A0";
const ZAPI_TOKEN = "B342684DF915A4F6BDA35E78";
const ZAPI_CLIENT_TOKEN = "F4d697803a4b14b5d9170e716aaad4faaS";
const GRUPO_PEDIDOS = "120363410027685846-group";
const GRUPO_ENTREGAS = "120363407991521682-group";

async function sendMessage(phone, message) {
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({ phone, message }),
  });
  return await r.text();
}

function fmt(n) { return "R$ " + (Number(n) || 0).toFixed(2).replace(".", ","); }

function buildPedidoMsg(d) {
  const items = [];
  if (d.qty40 > 0) items.push(`${d.qty40}x Kroc 40g`);
  if (d.qty240 > 0) items.push(`${d.qty240}x Kroc 240g`);
  if (d.qty500 > 0) items.push(`${d.qty500}x Kroc 500g`);

  let msg = `🥣 NOVO PEDIDO KROC\n\n`;
  msg += `👤 ${d.name}\n`;
  msg += `📱 ${d.phone}\n`;
  if (d.email) msg += `📧 ${d.email}\n`;
  msg += `\n📦 ${items.join(" + ")}\n`;
  msg += `\n💰 Subtotal: ${fmt(d.subtotal)}\n`;
  if (d.couponCode) {
    msg += `🎟️ Cupom ${d.couponCode} (-${d.discountPct || 0}%): -${fmt(d.discountVal || 0)}\n`;
  }
  msg += `🛵 Frete: ${fmt(d.frete)}\n`;
  msg += `💵 Total: ${fmt(d.total)}`;
  return msg;
}

function buildEntregaMsg(d) {
  const items = [];
  if (d.qty40 > 0) items.push(`${d.qty40}x 40g`);
  if (d.qty240 > 0) items.push(`${d.qty240}x 240g`);
  if (d.qty500 > 0) items.push(`${d.qty500}x 500g`);

  let msg = `🛵 NOVA ENTREGA KROC\n\n`;
  msg += `👤 ${d.name}\n`;
  msg += `📱 ${d.phone}\n\n`;
  msg += `📍 ${d.rua}, ${d.numero}`;
  if (d.complemento) msg += ` - ${d.complemento}`;
  msg += `\n${d.bairro} - ${d.cidade}/${d.estado}\n`;
  msg += `CEP: ${d.cep}\n\n`;
  msg += `📦 ${items.join(" + ")}\n`;
  if (d.couponCode) msg += `🎟️ ${d.couponCode}\n`;
  msg += `💵 ${fmt(d.total)}`;
  return msg;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false });
  try {
    const body = req.body || {};
    const pedidoMsg = body.pedidoMsg || buildPedidoMsg(body);
    const entregaMsg = body.entregaMsg || buildEntregaMsg(body);
    const [pedidos, entregas] = await Promise.all([
      sendMessage(GRUPO_PEDIDOS, pedidoMsg),
      sendMessage(GRUPO_ENTREGAS, entregaMsg),
    ]);
    return res.status(200).json({ success: true, pedidos, entregas });
  } catch (error) {
    return res.status(500).json({ success: false, error: String(error) });
  }
}
