export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var body = req.body;

    // EmailJS REST API (server-side)
    var emailRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: "service_seg2uxg",
        template_id: "template_1ay263j",
        user_id: "EU94wFheUNx3IA5v-",
        template_params: {
          customer_name: body.order_nsu || "Pedido",
          customer_phone: "",
          order_details: (body.items || []).map(function(i) {
            return i.quantity + "x " + i.description + " - R$ " + (i.price / 100).toFixed(2);
          }).join("\n"),
          order_total: "R$ " + ((body.paid_amount || body.amount || 0) / 100).toFixed(2),
          delivery_address: "Metodo: " + (body.capture_method || "N/A") + "\nNSU: " + (body.transaction_nsu || "N/A"),
          order_date: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        },
      }),
    });

    if (emailRes.ok) {
      return res.status(200).json({ success: true });
    }
    return res.status(200).json({ success: true, email: "failed" });
  } catch (error) {
    // Return 200 so InfinitiPay doesn't retry
    return res.status(200).json({ success: true, error: error.message });
  }
}
