export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var response = await fetch(
      "https://script.google.com/macros/s/AKfycbz58hFlnL3r9GizF5O9NBMEYE6VwcVuZfKqq26g5t3qNPrDl_X1o0J3vLl5kDVU0wE2/exec",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
        redirect: "follow",
      }
    );

    var text = await response.text();
    try {
      var data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(200).json({ success: true, raw: text });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
