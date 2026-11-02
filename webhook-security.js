const crypto=require("crypto");

function matchesHmacSha256(rawBody,secret,signature){
  if(!Buffer.isBuffer(rawBody)||!secret||typeof signature!=="string"||!/^[a-f\d]{64}$/i.test(signature))return false;
  const expected=crypto.createHmac("sha256",secret).update(rawBody).digest();
  const received=Buffer.from(signature,"hex");
  return received.length===expected.length&&crypto.timingSafeEqual(received,expected);
}

function parseRazorpayPaymentEvent(body){
  if(!body||typeof body!=="object"||Array.isArray(body)||!["payment.captured","order.paid"].includes(body.event))return null;
  const payment=body.payload&&body.payload.payment&&body.payload.payment.entity;
  if(!payment||typeof payment.id!=="string"||!payment.id||payment.id.length>40||typeof payment.order_id!=="string"||!payment.order_id||payment.order_id.length>40||!Number.isSafeInteger(payment.amount)||payment.amount<1)return null;
  return payment;
}

function paymentAlreadyHandled(status){
  return["paid","refunded","refund_pending"].includes(status);
}

module.exports={matchesHmacSha256,parseRazorpayPaymentEvent,paymentAlreadyHandled};
