/* Copy to payment-config.js and fill in your own receiving details.
   PayPal: clientId is public and safe in the browser. Never put the secret here. */
window.NOVA_PAYMENT = {
  bank: { name: "Your bank", code: "TCB", account: "0000000000", holder: "YOUR NAME", branch: "" },
  paypal: { clientId: "", email: "", link: "https://paypal.me/yourname", mode: "sandbox" },
  contact: { email: "you@example.com", telegram: "" },
  memo_prefix: "NOVA",
};
