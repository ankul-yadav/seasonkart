// Policy pages. Text is a solid starting template for an Indian online store - have a lawyer/CA review before going live.
// Store details come from .env (STORE_NAME, STORE_EMAIL, STORE_PHONE, STORE_ADDRESS, STORE_GSTIN, GRIEVANCE_OFFICER).
const PAGES={
about:{t:"About & Contact",h:(c,e)=>`<h2>About &amp; Contact</h2>
<p>${e(c.name)} is an online store. We work with trusted supplier partners so you get wide choice at fair prices, delivered to your door.</p>
<h3>Contact us</h3>
<p>Email: <b>${e(c.email||"[add STORE_EMAIL in .env]")}</b><br>Phone: <b>${e(c.phone||"[add STORE_PHONE in .env]")}</b><br>Address: ${e(c.address||"[add STORE_ADDRESS in .env]")}${c.gstin?`<br>GSTIN: ${e(c.gstin)}`:""}</p>
<h3>Grievance Officer</h3>
<p>As required under the Consumer Protection (E-Commerce) Rules, 2020: <b>${e(c.officer||"[add GRIEVANCE_OFFICER in .env]")}</b>, ${e(c.email||"[email]")}. We acknowledge complaints within 48 hours and aim to resolve them within one month.</p>`},

shipping:{t:"Shipping Policy",h:(c,e)=>`<h2>Shipping Policy</h2>
<p>Last updated: October 2026</p>
<h3>Delivery time</h3>
<p>Orders are packed within 1-2 business days. Delivery usually takes <b>${e(c.shipDays)} business days</b> after dispatch, depending on your location. These are estimates, not guarantees; weather, festivals and courier delays can add time.</p>
<h3>Shipping charges</h3>
<p>Shipping is <b>free on orders of ₹${c.freeShipAbove} and above</b>. A flat fee of ₹${c.shipFee} applies below that.</p>
<h3>Multiple shipments</h3>
<p>Because items may be fulfilled by different supplier partners, one order can arrive in more than one parcel, on different days. You pay shipping only once.</p>
<h3>Tracking</h3>
<p>Track your order any time from <a href="#orders">My Orders</a> (when logged in) or the <a href="#track">Track order</a> page using your Order ID and phone number. We also send updates by email/SMS when your order is shipped and delivered.</p>
<h3>Wrong address / failed delivery</h3>
<p>Please enter a complete address and a reachable phone number. If delivery fails because of an incorrect address or no response, the courier may return the parcel and we may charge re-shipping.</p>`},

returns:{t:"Returns & Refunds",h:(c,e)=>`<h2>Returns, Cancellation &amp; Refunds</h2>
<p>Last updated: October 2026</p>
<h3>Cancel an order</h3>
<p>You can cancel from <a href="#orders">My Orders</a> while the order is still <b>Processing</b>. Once it is shipped it cannot be cancelled, but you can return it after delivery.</p>
<h3>Return an item</h3>
<p>Return rules are shown on every product page. Some items (for example innerwear, food, personalised or hygiene products) cannot be returned unless they arrive damaged or wrong.</p>
<p>You can request a return within <b>${c.returnDays} days of delivery</b> from My Orders &gt; Request return. Items must be unused, unwashed, with tags and original packaging. For hygiene reasons, innerwear, socks and similar personal items cannot be returned unless they arrive damaged or wrong.</p>
<p>If you received a damaged, defective or wrong product, write to <b>${e(c.email||"our support email")}</b> within ${c.returnDays} days with your Order ID and clear photos. We will arrange a replacement or refund.</p>
<h3>Approval</h3>
<p>Every return request is reviewed. We may ask for photos. If approved, we will tell you by email/SMS and process the refund.</p>
<h3>How refunds are paid</h3>
<p><b>Online payments:</b> refunded to the original payment method. It usually appears in 5-7 working days after we issue it, depending on your bank.<br>
<b>Cash on delivery:</b> refunded by UPI or bank transfer; we will contact you for the details.<br>
<b>Cancelled or failed payments:</b> if money was deducted but the order was not confirmed, it is refunded automatically in 5-7 working days.</p>
<p>Shipping charges are non-refundable unless the return is due to our error.</p>`},

privacy:{t:"Privacy Policy",h:(c,e)=>`<h2>Privacy Policy</h2>
<p>Last updated: October 2026. This policy explains how ${e(c.name)} ("we") handles your personal data, in line with Indian law including the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.</p>
<h3>What we collect</h3>
<ul><li>Details you give us: name, phone number, email, delivery address, and your account password (stored only in hashed form).</li>
<li>Order details: items, amounts, payment status and delivery status.</li>
<li>Payment: handled by Razorpay. We never see or store your card, UPI or bank details.</li></ul>
<h3>How we use it</h3>
<p>To process and deliver orders, send order/shipping/refund updates by email and SMS, provide your account and order history, prevent fraud, handle returns and support, and meet legal and tax requirements.</p>
<h3>Who we share it with</h3>
<p>Only what is needed to fulfil your order: supplier partners who pack and ship it (name, phone, address, items), courier partners, our payment gateway (Razorpay), and our email/SMS providers. We do not sell your personal data.</p>
<h3>Cookies &amp; local storage</h3>
<p>We use your browser's local storage to keep your cart and keep you logged in. We do not use advertising or third-party tracking cookies.</p>
<h3>Retention &amp; security</h3>
<p>We keep order records for as long as needed for legal, tax and accounting purposes. Data is protected with encrypted connections (HTTPS), hashed passwords and access controls, though no system is perfectly secure.</p>
<h3>Your rights</h3>
<p>You can ask to access, correct or delete your personal data, or withdraw consent, by writing to <b>${e(c.email||"our support email")}</b>. Some records must be retained by law. Our service is not meant for children under 18.</p>
<h3>Changes &amp; contact</h3>
<p>We may update this policy and will change the date above. Questions or complaints: <b>${e(c.officer||"Grievance Officer")}</b>, ${e(c.email||"[email]")}.</p>`},

terms:{t:"Terms & Conditions",h:(c,e)=>`<h2>Terms &amp; Conditions</h2>
<p>Last updated: October 2026. By using this website or placing an order, you agree to these terms.</p>
<h3>1. Use of the site</h3>
<p>You must be 18 or older, or use the site with a parent/guardian. Give accurate information and keep your password safe; you are responsible for activity under your account.</p>
<h3>2. Products &amp; prices</h3>
<p>We try to show colours and details accurately, but screens vary. All prices are in Indian Rupees and include applicable taxes unless stated. Prices and availability can change without notice. If a product is listed at a wrong price or is out of stock, we may cancel the order and refund you in full.</p>
<h3>3. Orders &amp; payment</h3>
<p>An order is confirmed when you receive our confirmation. We may refuse or cancel orders for stock issues, pricing errors, suspected fraud or undeliverable addresses. Online payments are processed securely by Razorpay. Cash on delivery may be unavailable for some orders.</p>
<h3>4. Shipping, cancellation &amp; returns</h3>
<p>These are governed by our <a href="#page-shipping">Shipping Policy</a> and <a href="#page-returns">Returns &amp; Refunds policy</a>, which are part of these terms.</p>
<h3>5. Intellectual property</h3>
<p>The site's design, logo, text and images belong to ${e(c.name)} or its licensors. Do not copy or reuse them without permission.</p>
<h3>6. Limitation of liability</h3>
<p>To the extent permitted by law, our liability for any claim relating to an order is limited to the amount you paid for that order. We are not liable for delays caused by events beyond our control.</p>
<h3>7. Governing law</h3>
<p>These terms are governed by the laws of India. Courts at ${e((c.address||"").split(",").slice(-2,-1)[0]||"our registered city")} will have jurisdiction, subject to your rights under consumer protection law.</p>
<h3>8. Complaints</h3>
<p>Contact our Grievance Officer: <b>${e(c.officer||"[name]")}</b>, ${e(c.email||"[email]")}, ${e(c.phone||"[phone]")}. See <a href="#page-about">Contact</a>.</p>`}
};
